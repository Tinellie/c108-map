import { runCrawlPipeline } from "./crawlPipeline.js";
import { getProfileByName, getProfileOptions } from "../profiles/index.js";

const DEFAULT_URL = "https://classic-webcatalog.circle.ms/User/Favorites?count=120";
const DEFAULT_CRAWL_MODE = "full_list_new_detail";
const MAX_HISTORY = 20;

let nextJobId = 1;
let runningJob = null;
const jobHistory = [];

function nowIso() {
  return new Date().toISOString();
}

function sanitizeSummary(summary) {
  if (!summary || typeof summary !== "object") {
    return null;
  }

  return {
    crawlMode: summary.crawlMode || "",
    url: summary.url || "",
    title: summary.title || "",
    pagesProcessed: Number(summary.pagesProcessed || 0),
    totalItems: Number(summary.totalItems || 0),
    totalCircles: Number(summary.totalCircles || 0),
    totalNewCircles: Number(summary.totalNewCircles || 0),
    totalCirclesWritten: Number(summary.totalCirclesWritten || 0),
    changedCircles: Number(summary.changedCircles || 0),
    newCirclesInserted: Number(summary.newCirclesInserted || 0),
    detailTargets: Number(summary.detailTargets || 0),
    uniqueNewCircles: Number(summary.uniqueNewCircles || 0),
    imagesDownloaded: Number(summary.imagesDownloaded || 0),
    imagesSkipped: Number(summary.imagesSkipped || 0)
  };
}

function sanitizeProgress(progress) {
  if (!progress || typeof progress !== "object") {
    return null;
  }

  return {
    stage: String(progress.stage || "").trim() || "unknown",
    originalCount: Number(progress.originalCount || 0),
    newCount: Number(progress.newCount || 0),
    totalCount: Number(progress.totalCount || 0),
    pagesProcessed: Number(progress.pagesProcessed || 0),
    detailDone: Number(progress.detailDone || 0),
    detailTotal: Number(progress.detailTotal || 0),
    detailFailed: Number(progress.detailFailed || 0),
    message: String(progress.message || "").trim(),
    currentCircleId: String(progress.currentCircleId || "").trim()
  };
}

function toPublicJob(job) {
  if (!job) {
    return null;
  }

  return {
    jobId: job.jobId,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
    durationMs: job.durationMs || null,
    request: {
      url: job.request.url,
      profile: job.request.profile,
      headless: job.request.headless,
      crawlMode: job.request.crawlMode
    },
    summary: sanitizeSummary(job.summary),
    progress: sanitizeProgress(job.progress),
    error: job.error || null
  };
}

function pushHistory(job) {
  jobHistory.unshift(toPublicJob(job));
  if (jobHistory.length > MAX_HISTORY) {
    jobHistory.length = MAX_HISTORY;
  }
}

export function getCrawlOptions() {
  return {
    defaultUrl: DEFAULT_URL,
    targetUrlLocked: true,
    supportsCircleMsAutoLogin: true,
    profiles: getProfileOptions(),
    headlessOptions: [
      { value: "env", label: "Use environment default" },
      { value: "true", label: "Headless true" },
      { value: "false", label: "Headless false" }
    ],
    defaultCrawlMode: DEFAULT_CRAWL_MODE,
    crawlModes: [
      {
        value: "full_list_new_detail",
        label: "Full list + new detail only",
        description:
          "Scrape all list pages but only crawl detail pages for circles not existing in DB before this run"
      },
      {
        value: "full_list_full_detail",
        label: "Full list + full detail",
        description:
          "Scrape all list pages and all detail pages; upsert existing circles and insert new ones"
      },
      {
        value: "new_list_new_detail",
        label: "New list + new detail only",
        description:
          "Write only circles not existing in DB before this run, then crawl detail pages only for those new circles"
      },
      {
        value: "list_only",
        label: "List only",
        description:
          "Scrape all list pages and upsert list fields only; skip all detail-page crawling"
      }
    ],
    requestSchema: {
      url: `locked to ${DEFAULT_URL}`,
      profile: "string (required, one of profiles)",
      headless: "'env' | 'true' | 'false' (optional, default 'env')",
      crawlMode: `'full_list_full_detail' | 'full_list_new_detail' | 'new_list_new_detail' | 'list_only' (optional, default '${DEFAULT_CRAWL_MODE}')`,
      loginUsername: "string (optional, Circle.ms email)",
      loginPassword: "string (optional, Circle.ms password)"
    }
  };
}

export function getCurrentCrawlJob() {
  return toPublicJob(runningJob);
}

export function getCrawlJobHistory(limit = 10) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), MAX_HISTORY);
  return jobHistory.slice(0, safeLimit);
}

export function getCrawlJobById(jobId) {
  const target = String(jobId || "").trim();
  if (!target) {
    return null;
  }

  if (runningJob && String(runningJob.jobId) === target) {
    return toPublicJob(runningJob);
  }

  return jobHistory.find((job) => String(job.jobId) === target) || null;
}

export function startCrawlJob(input) {
  if (runningJob) {
    const error = new Error("A crawl job is already running");
    error.code = "JOB_ALREADY_RUNNING";
    throw error;
  }

  const url = DEFAULT_URL;
  const profileName = String(input?.profile || "circle-favorites").trim();
  const headlessRaw = String(input?.headless || "env").trim();
  const crawlMode = String(input?.crawlMode || DEFAULT_CRAWL_MODE).trim();
  const loginUsername = String(input?.loginUsername || "").trim();
  const loginPassword = String(input?.loginPassword || "");
  const profile = getProfileByName(profileName);

  if (!profile) {
    const error = new Error(`Unknown profile: ${profileName}`);
    error.code = "INVALID_INPUT";
    throw error;
  }

  if (!["env", "true", "false"].includes(headlessRaw)) {
    const error = new Error("headless must be one of: env, true, false");
    error.code = "INVALID_INPUT";
    throw error;
  }

  const allowedModes = new Set(["full_list_full_detail", "full_list_new_detail", "new_list_new_detail", "list_only"]);
  if (!allowedModes.has(crawlMode)) {
    const error = new Error("crawlMode is invalid");
    error.code = "INVALID_INPUT";
    throw error;
  }

  if ((loginUsername && !loginPassword) || (!loginUsername && loginPassword)) {
    const error = new Error("loginUsername and loginPassword must be provided together");
    error.code = "INVALID_INPUT";
    throw error;
  }

  const headlessOverride =
    headlessRaw === "env" ? undefined : headlessRaw === "true";

  const job = {
    jobId: `${Date.now()}-${nextJobId++}`,
    status: "running",
    startedAt: nowIso(),
    finishedAt: null,
    durationMs: null,
    request: {
      url,
      profile: profileName,
      headless: headlessRaw,
      crawlMode
    },
    summary: null,
    progress: {
      stage: "starting",
      originalCount: 0,
      newCount: 0,
      totalCount: 0,
      pagesProcessed: 0,
      detailDone: 0,
      detailTotal: 0,
      detailFailed: 0,
      message: ""
    },
    error: null
  };

  runningJob = job;

  const updateProgress = (nextProgress) => {
    if (!nextProgress || typeof nextProgress !== "object") {
      return;
    }

    job.progress = {
      ...(job.progress || {}),
      ...nextProgress
    };
  };

  const done = runCrawlPipeline({
    url,
    profile,
    headlessOverride,
    crawlMode,
    loginCredentials: loginUsername && loginPassword
      ? { username: loginUsername, password: loginPassword }
      : null,
    onProgress: updateProgress
  })
    .then((summary) => {
      job.status = "succeeded";
      job.summary = sanitizeSummary(summary);
    })
    .catch((error) => {
      job.status = "failed";
      job.error = error?.message || "unknown error";
    })
    .finally(() => {
      const finishedAt = new Date();
      job.finishedAt = finishedAt.toISOString();
      job.durationMs = finishedAt.getTime() - new Date(job.startedAt).getTime();
      pushHistory(job);

      if (runningJob && runningJob.jobId === job.jobId) {
        runningJob = null;
      }
    });

  return {
    job: toPublicJob(job),
    done
  };
}