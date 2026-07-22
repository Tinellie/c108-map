import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureSchema } from "../db/setup.js";
import { loadExistingCircleIdSet, upsertCircleDetails, upsertFavoriteCircles } from "../repositories/crawlRepository.js";
import { loadColorPaletteMap } from "../repositories/colorPaletteRepository.js";
import { clickPreviousPage, createScrapeSession, ensureLoggedInIfNeeded, jumpToLastPage, scrapeCurrentPage } from "./scrapeService.js";
import { organizeItems } from "../utils/organize.js";
import { downloadCircleImages } from "./imageDownloadService.js";
import { scrapeCircleDetail } from "./circleDetailService.js";
import { config } from "../config/env.js";
import { logInfo, logStep, logSuccess, logWarn } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const JOB_FAILURE_SCREENSHOT_DIR = path.join(projectRoot, "storage", "crawl_debug", "job_failures");
const JOB_LIVE_SCREENSHOT_DIR = path.join(projectRoot, "storage", "crawl_debug", "job_live");
const LIVE_SCREENSHOT_INTERVAL_MS = 12000;

function createCancelledError() {
  const error = new Error("Crawl cancelled by user");
  error.code = "CRAWL_CANCELLED";
  return error;
}

const CRAWL_MODES = {
  full_list_full_detail: {
    crawlDetail: true,
    listWrite: "all",
    detailScope: "all"
  },
  full_list_new_detail: {
    crawlDetail: true,
    listWrite: "all",
    detailScope: "new-only"
  },
  new_list_new_detail: {
    crawlDetail: true,
    listWrite: "new-only",
    detailScope: "new-only"
  },
  list_only: {
    crawlDetail: false,
    listWrite: "all",
    detailScope: "none"
  }
};

function normalizeColor(value) {
  const match = String(value || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  return `rgb(${match[1]}, ${match[2]}, ${match[3]})`;
}

function toFavoriteCircles(items, colorPaletteMap) {
  return items
    .filter((item) => item.type === "circle")
    .map((item) => ({
      circle_id: item.metadata?.circleId || item.key || null,
      color_index: colorPaletteMap.get(normalizeColor(item.metadata?.bgColor)) || null,
      booth_location: item.metadata?.booth_location || item.value || null,
      circle_name: item.metadata?.name || item.text || null,
      genre: item.metadata?.genre || null,
      memo: item.metadata?.memo || null,
      detail_url: item.metadata?.detailUrl || null,
      source_images: item.metadata?.imageUrls || []
    }))
    .filter((circle) => circle.circle_id && circle.circle_name);
}

function normalizeRelativePath(filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

async function captureFailureScreenshot(page, { crawlMode } = {}) {
  if (!page || page.isClosed()) {
    return null;
  }

  await fs.mkdir(JOB_FAILURE_SCREENSHOT_DIR, { recursive: true });
  const safeMode = String(crawlMode || "crawl").replace(/[^a-z0-9_-]+/gi, "_");
  const fileName = `${Date.now()}-${safeMode}.png`;
  const absolutePath = path.join(JOB_FAILURE_SCREENSHOT_DIR, fileName);

  await page.screenshot({
    path: absolutePath,
    type: "png",
    fullPage: true
  });

  return {
    absolutePath,
    relativePath: normalizeRelativePath(absolutePath)
  };
}

async function captureLiveScreenshot(page, { jobId } = {}) {
  if (!page || page.isClosed()) {
    return null;
  }

  await fs.mkdir(JOB_LIVE_SCREENSHOT_DIR, { recursive: true });
  const safeJobId = String(jobId || "job").replace(/[^a-z0-9_-]+/gi, "_");
  const fileName = `${safeJobId}.jpg`;
  const absolutePath = path.join(JOB_LIVE_SCREENSHOT_DIR, fileName);

  await page.screenshot({
    path: absolutePath,
    type: "jpeg",
    quality: 65,
    fullPage: false
  });

  return {
    absolutePath,
    relativePath: normalizeRelativePath(absolutePath),
    capturedAt: new Date().toISOString()
  };
}

export async function runCrawlPipeline({
  url,
  profile,
  headlessOverride,
  crawlMode = "full_list_full_detail",
  jobId,
  cancelSignal,
  loginCredentials,
  onProgress
}) {
  const mode = CRAWL_MODES[crawlMode] || CRAWL_MODES.full_list_full_detail;
  const emitProgress = typeof onProgress === "function" ? onProgress : () => {};
  const abortSignal = cancelSignal && typeof cancelSignal === "object" ? cancelSignal : null;

  function throwIfCancelled() {
    if (abortSignal?.aborted) {
      throw createCancelledError();
    }
  }

  logStep("Ensuring database schema");
  await ensureSchema();
  logSuccess("Schema ready");

  logStep("Loading existing circle ids");
  const existingCircleIds = await loadExistingCircleIdSet();
  const existingCircleIdsAtStart = new Set(existingCircleIds);
  logSuccess("Existing circle ids loaded", `count=${existingCircleIds.size}`);

  logStep("Loading color palette mapping");
  const colorPaletteMap = await loadColorPaletteMap();
  logSuccess("Color palette loaded", `entries=${colorPaletteMap.size}`);

  const session = await createScrapeSession({ headlessOverride });

  const visitedUrls = new Set();
  const pageSummaries = [];
  const allCircles = new Map();
  const newCircleIdsSeen = new Set();
  const changedCircleIdsWritten = new Set();
  const newCircleIdsInserted = new Set();
  let detailTargets = 0;
  let pageIndex = 0;
  let lastScraped = null;
  let page = null;
  let lastLiveScreenshotAtMs = 0;
  let liveDebugTimer = null;
  let liveDebugTickInFlight = false;
  let abortHandler = null;

  async function emitProgressWithLiveScreenshot(nextProgress, { forceScreenshot = false } = {}) {
    throwIfCancelled();

    const nowMs = Date.now();
    const shouldCapture =
      Boolean(forceScreenshot) ||
      !lastLiveScreenshotAtMs ||
      nowMs - lastLiveScreenshotAtMs >= LIVE_SCREENSHOT_INTERVAL_MS;

    if (!shouldCapture) {
      emitProgress(nextProgress);
      return;
    }

    try {
      const screenshot = await captureLiveScreenshot(page, { jobId });
      if (screenshot?.relativePath) {
        lastLiveScreenshotAtMs = nowMs;
        emitProgress({
          ...nextProgress,
          liveScreenshotPath: screenshot.relativePath,
          liveScreenshotCapturedAt: screenshot.capturedAt
        });
        return;
      }
    } catch (error) {
      logWarn("Live screenshot capture failed", error?.message || "unknown");
    }

    emitProgress(nextProgress);
  }

  function startLiveDebugTicker() {
    if (liveDebugTimer) {
      return;
    }

    const tick = () => {
      if (liveDebugTickInFlight) {
        return;
      }

      if (!page || page.isClosed() || abortSignal?.aborted) {
        return;
      }

      liveDebugTickInFlight = true;
      Promise.resolve()
        .then(async () => {
          const nowIso = new Date().toISOString();
          const currentUrl = page.url();

          await emitProgressWithLiveScreenshot(
            {
              debugLog: `[${nowIso}] heartbeat url=${currentUrl}`,
              debugLogAt: nowIso
            },
            { forceScreenshot: true }
          );
        })
        .catch((error) => {
          if (abortSignal?.aborted) {
            return;
          }
          logWarn("Live debug heartbeat failed", error?.message || "unknown");
        })
        .finally(() => {
          liveDebugTickInFlight = false;
        });
    };

    tick();
    liveDebugTimer = setInterval(tick, LIVE_SCREENSHOT_INTERVAL_MS);
  }

  await emitProgressWithLiveScreenshot({
    stage: "list",
    originalCount: existingCircleIdsAtStart.size,
    newCount: 0,
    totalCount: 0,
    pagesProcessed: 0,
    detailDone: 0,
    detailTotal: 0,
    detailFailed: 0,
    message: `Original items: ${existingCircleIdsAtStart.size}`
  });

  try {
    throwIfCancelled();
    ({ page } = session);
    abortHandler = () => {
      logWarn("Crawl cancellation requested", `jobId=${jobId || ""}`);
      session.close().catch(() => {});
    };

    if (abortSignal) {
      abortSignal.addEventListener("abort", abortHandler, { once: true });
    }

    startLiveDebugTicker();

    throwIfCancelled();
    await page.goto(url, { waitUntil: "networkidle2" });
    throwIfCancelled();
    await ensureLoggedInIfNeeded(page, profile, { loginCredentials });
    throwIfCancelled();

    logStep("Navigating to last page before crawl");
    const lastUrl = await jumpToLastPage(page, profile);
    if (lastUrl) {
      logInfo("Jumped to last page", lastUrl);
    } else {
      logInfo("Last page jump skipped", "Already on last page or no last-page button found");
    }

    while (true) {
      throwIfCancelled();
      const currentUrl = page.url();
      if (visitedUrls.has(currentUrl)) {
        logWarn("Detected repeated page URL, stopping pagination", currentUrl);
        break;
      }

      visitedUrls.add(currentUrl);
      pageIndex += 1;

      logStep("Scraping page", `page=${pageIndex}, profile=${profile.name}`);
      const scraped = await scrapeCurrentPage(page, { profile, loginCredentials });
      lastScraped = scraped;
      logInfo("Page loaded", `page=${pageIndex}, title=${scraped.title || "(empty)"}`);

      logStep("Organizing extracted items");
      const items = organizeItems(scraped.rawItems);
      logInfo("Items organized", `page=${pageIndex}, raw=${scraped.rawItems.length}, cleaned=${items.length}`);

      const circles = toFavoriteCircles(items, colorPaletteMap);
      logInfo("Circle rows mapped", `page=${pageIndex}, count=${circles.length}`);
      if (!circles.length) {
        logWarn("No circle rows found on this page. You may still be on login page or selectors changed.");
      }

      const newCircles = circles.filter((circle) => !existingCircleIds.has(circle.circle_id));
      for (const circle of newCircles) {
        newCircleIdsSeen.add(circle.circle_id);
      }

      const circlesForListWrite = mode.listWrite === "new-only" ? newCircles : circles;
      const circlesForDetail = mode.detailScope === "new-only" ? newCircles : circles;

      for (const circle of circlesForListWrite) {
        if (existingCircleIdsAtStart.has(circle.circle_id)) {
          changedCircleIdsWritten.add(circle.circle_id);
        } else {
          newCircleIdsInserted.add(circle.circle_id);
        }
      }

      for (const circle of circlesForDetail) {
        allCircles.set(circle.circle_id, {
          circle_id: circle.circle_id,
          detail_url: circle.detail_url
        });
      }
      detailTargets = allCircles.size;

      await emitProgressWithLiveScreenshot({
        stage: "list",
        originalCount: existingCircleIdsAtStart.size,
        newCount: newCircleIdsSeen.size,
        totalCount: allCircles.size,
        pagesProcessed: pageIndex,
        detailDone: 0,
        detailTotal: 0,
        detailFailed: 0,
        message: `Original items: ${existingCircleIdsAtStart.size}, new items: ${newCircleIdsSeen.size}`
      });

      const imageStats = await downloadCircleImages(circlesForListWrite, {
        pageUrl: scraped.url,
        cookies: scraped.cookies || [],
        downloadDir: config.images.downloadDir
      });
      logInfo(
        "Images processed",
        `page=${pageIndex}, downloaded=${imageStats.downloaded}, skipped=${imageStats.skipped}, listWrite=${circlesForListWrite.length}`
      );

      logStep("Writing circles to database", `page=${pageIndex}`);
      await upsertFavoriteCircles(circlesForListWrite);
      logSuccess("Database write complete", `page=${pageIndex}, upserted=${circlesForListWrite.length}`);

      for (const circle of circlesForListWrite) {
        existingCircleIds.add(circle.circle_id);
      }

      pageSummaries.push({
        pageIndex,
        url: scraped.url,
        title: scraped.title,
        items: items.length,
        circles: circles.length,
        newCircles: newCircles.length,
        circlesWritten: circlesForListWrite.length,
        imagesDownloaded: imageStats.downloaded,
        imagesSkipped: imageStats.skipped
      });

      const previousUrl = await clickPreviousPage(page, profile);
      throwIfCancelled();
      if (!previousUrl) {
        break;
      }

      logInfo("Previous page clicked", previousUrl);
    }

    if (mode.crawlDetail && allCircles.size > 0) {
      logStep("Crawling circle detail pages", `count=${allCircles.size}`);
      const detailResults = [];
      let detailDone = 0;
      let detailFailed = 0;

      await emitProgressWithLiveScreenshot({
        stage: "detail",
        originalCount: existingCircleIdsAtStart.size,
        newCount: newCircleIdsSeen.size,
        totalCount: allCircles.size,
        pagesProcessed: pageSummaries.length,
        detailDone,
        detailTotal: allCircles.size,
        detailFailed,
        message: `Detail crawl started: 0/${allCircles.size}`
      }, { forceScreenshot: true });

      for (const circle of allCircles.values()) {
        throwIfCancelled();
        try {
          const detail = await scrapeCircleDetail(page, {
            circleId: circle.circle_id,
            detailUrl: circle.detail_url
          });
          detailResults.push(detail);
        } catch (error) {
          detailFailed += 1;
          logWarn("Circle detail crawl failed", `circle_id=${circle.circle_id}, reason=${error?.message || "unknown"}`);
        } finally {
          detailDone += 1;
          await emitProgressWithLiveScreenshot({
            stage: "detail",
            originalCount: existingCircleIdsAtStart.size,
            newCount: newCircleIdsSeen.size,
            totalCount: allCircles.size,
            pagesProcessed: pageSummaries.length,
            detailDone,
            detailTotal: allCircles.size,
            detailFailed,
            currentCircleId: circle.circle_id,
            message: `Detail crawl: ${detailDone}/${allCircles.size}`
          });
        }
      }

      logStep("Writing detail fields to database", `rows=${detailResults.length}`);
      await upsertCircleDetails(detailResults);
      logSuccess("Detail write complete", `rows=${detailResults.length}`);
      await emitProgressWithLiveScreenshot({
        stage: "detail",
        originalCount: existingCircleIdsAtStart.size,
        newCount: newCircleIdsSeen.size,
        totalCount: allCircles.size,
        pagesProcessed: pageSummaries.length,
        detailDone,
        detailTotal: allCircles.size,
        detailFailed,
        message: `Detail write complete: ${detailResults.length}`
      }, { forceScreenshot: true });
    } else if (!mode.crawlDetail) {
      logInfo("Detail crawl skipped", `mode=${crawlMode}`);
    }
  } catch (error) {
    if (abortSignal?.aborted || error?.code === "CRAWL_CANCELLED") {
      throw createCancelledError();
    }

    try {
      const screenshot = await captureFailureScreenshot(page, { crawlMode });
      if (screenshot?.relativePath && error && typeof error === "object") {
        error.failureScreenshotPath = screenshot.relativePath;
        logWarn("Crawl failed, screenshot captured", screenshot.relativePath);
      }
    } catch (screenshotError) {
      logWarn("Crawl failed, but screenshot capture also failed", screenshotError?.message || "unknown");
    }

    throw error;
  } finally {
    if (liveDebugTimer) {
      clearInterval(liveDebugTimer);
      liveDebugTimer = null;
    }

    if (abortSignal && abortHandler) {
      abortSignal.removeEventListener("abort", abortHandler);
    }

    await session.close().catch(() => {});
  }

  const pagesProcessed = pageSummaries.length;
  const totalItems = pageSummaries.reduce((sum, item) => sum + item.items, 0);
  const totalCircles = pageSummaries.reduce((sum, item) => sum + item.circles, 0);
  const totalNewCircles = pageSummaries.reduce((sum, item) => sum + item.newCircles, 0);
  const totalCirclesWritten = pageSummaries.reduce((sum, item) => sum + item.circlesWritten, 0);
  const imagesDownloaded = pageSummaries.reduce((sum, item) => sum + item.imagesDownloaded, 0);
  const imagesSkipped = pageSummaries.reduce((sum, item) => sum + item.imagesSkipped, 0);

  if (pagesProcessed > 0 && totalCircles === 0) {
    throw new Error(
      "Crawl finished without extracting any circle rows. Likely causes: login expired or page selectors changed."
    );
  }

  return {
    crawlMode,
    url: lastScraped?.url || url,
    title: pageSummaries[0]?.title || "",
    pagesProcessed,
    totalItems,
    totalCircles,
    totalNewCircles,
    totalCirclesWritten,
    changedCircles: changedCircleIdsWritten.size,
    newCirclesInserted: newCircleIdsInserted.size,
    detailTargets,
    uniqueNewCircles: newCircleIdsSeen.size,
    imagesDownloaded,
    imagesSkipped,
    pageSummaries
  };
}
