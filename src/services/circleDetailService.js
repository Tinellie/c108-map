import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const detailFailureRoot = path.join(projectRoot, "storage", "crawl_debug", "detail_failures");

function toAbsoluteUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  return new URL(rawUrl, "https://classic-webcatalog.circle.ms").href;
}

function extractPixivId(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const url = new URL(rawUrl);
    if (!/pixiv\.net$/i.test(url.hostname)) {
      return null;
    }

    const queryId = cleanText(url.searchParams.get("id"));
    if (queryId) {
      return queryId;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const usersIndex = parts.findIndex((part) => part === "users");
    if (usersIndex >= 0 && parts[usersIndex + 1]) {
      return cleanText(parts[usersIndex + 1]);
    }

    return cleanText(parts[parts.length - 1] || "") || null;
  } catch {
    return null;
  }
}

function extractTwitterId(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const url = new URL(rawUrl);
    if (!/(^|\.)twitter\.com$/i.test(url.hostname) && !/(^|\.)x\.com$/i.test(url.hostname)) {
      return null;
    }

    const blocked = new Set([
      "home",
      "intent",
      "share",
      "i",
      "search",
      "hashtag",
      "explore",
      "messages",
      "notifications",
      "settings"
    ]);

    const firstSegment = (url.pathname.split("/").filter(Boolean)[0] || "").replace(/^@/, "");
    const candidate = cleanText(firstSegment);
    if (!candidate || blocked.has(candidate.toLowerCase())) {
      return null;
    }

    return candidate;
  } catch {
    return null;
  }
}

function sanitizePathSegment(value) {
  return String(value || "unknown")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .trim() || "unknown";
}

async function saveDetailFailureArtifact(page, { circleId, detailUrl, error }) {
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const safeCircleId = sanitizePathSegment(circleId);
  const failureDir = path.join(detailFailureRoot, safeCircleId, stamp);
  const screenshotPath = path.join(failureDir, "screenshot.png");
  const metaPath = path.join(failureDir, "meta.json");

  await fs.mkdir(failureDir, { recursive: true });

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch (screenshotError) {
    await fs.writeFile(
      metaPath,
      JSON.stringify({
        circleId,
        detailUrl,
        error: error?.message || "unknown error",
        screenshotError: screenshotError?.message || "failed to capture screenshot",
        capturedAt: startedAt.toISOString(),
        pageUrl: page.url()
      }, null, 2),
      "utf-8"
    );
    throw screenshotError;
  }

  await fs.writeFile(
    metaPath,
    JSON.stringify({
      circleId,
      detailUrl,
      error: error?.message || "unknown error",
      capturedAt: startedAt.toISOString(),
      pageUrl: page.url(),
      title: await page.title().catch(() => "")
    }, null, 2),
    "utf-8"
  );

  return {
    failureDir,
    screenshotPath,
    metaPath
  };
}

export async function scrapeCircleDetail(page, { circleId, detailUrl }) {
  const targetUrl = toAbsoluteUrl(detailUrl) || `https://classic-webcatalog.circle.ms/Circle/${circleId}`;
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("table.md-itemtable, table.md-itemtable--small", {
      timeout: 15000
    });

    const raw = await page.evaluate(() => {
      const tidy = (value) => (value || "").replace(/\s+/g, " ").trim();
      const table = document.querySelector("table.md-itemtable") || document.querySelector("table.md-itemtable--small");
      if (!table) {
        return {
          authorName: null,
          genre: null,
          pixivUrl: null,
          twitterUrl: null,
          tagsText: null,
          supplementText: null
        };
      }

      const rows = Array.from(table.querySelectorAll("tr"));
      const getRowByHeader = (keyword) =>
        rows.find((row) => {
          const th = row.querySelector("th");
          const header = tidy(th?.textContent || "");
          return header.includes(keyword);
        }) || null;

      const getRowValue = (keyword) => {
        const row = getRowByHeader(keyword);
        const cell = row?.querySelector("td");
        return tidy(cell?.textContent || "") || null;
      };

      const socialRow = getRowByHeader("サークル情報登録状況");
      const socialLinks = socialRow ? Array.from(socialRow.querySelectorAll("ul.support-list li a[href]")) : [];

      const findSocialUrl = (matcher) => {
        const node = socialLinks.find((link) => {
          const href = link.getAttribute("href") || "";
          const img = link.querySelector("img");
          const alt = tidy(img?.getAttribute("alt") || "").toLowerCase();
          const title = tidy(img?.getAttribute("title") || "").toLowerCase();
          return matcher({ href: href.toLowerCase(), alt, title });
        });
        const rawHref = node?.getAttribute("href") || "";
        return rawHref && rawHref !== "#" ? rawHref : null;
      };

      return {
        authorName: getRowValue("執筆者名"),
        genre: getRowValue("ジャンル"),
        pixivUrl: findSocialUrl(({ href, alt, title }) =>
          href.includes("pixiv.net") || alt.includes("pixiv") || title.includes("pixiv")
        ),
        twitterUrl: findSocialUrl(({ href, alt, title }) =>
          href.includes("twitter.com") || href.includes("x.com") || alt.includes("twitter") || alt === "x(twitter)" || title.includes("twitter") || title === "x(twitter)"
        ),
        tagsText: getRowValue("タグ"),
        supplementText: getRowValue("補足説明")
      };
    });

    const pixivAbs = toAbsoluteUrl(raw.pixivUrl);
    const twitterAbs = toAbsoluteUrl(raw.twitterUrl);

    return {
      circle_id: String(circleId),
      author_name: cleanText(raw.authorName) || null,
      genre: cleanText(raw.genre) || null,
      pixiv_id: extractPixivId(pixivAbs),
      twitter_id: extractTwitterId(twitterAbs),
      tags_text: cleanText(raw.tagsText) || null,
      supplement_text: cleanText(raw.supplementText) || null
    };
  } catch (error) {
    const artifacts = await saveDetailFailureArtifact(page, { circleId, detailUrl, error });
    console.warn(
      `Circle detail crawl failed circle_id=${circleId}, reason=${error?.message || "unknown error"} | screenshot=${artifacts.screenshotPath}`
    );
    throw error;
  }
}
