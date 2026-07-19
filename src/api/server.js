import cors from "cors";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../config/env.js";
import { pool, testConnection } from "../db/pool.js";
import { ensureSchema } from "../db/setup.js";
import { getColorPreferences, saveColorPreferences } from "../repositories/colorPreferenceRepository.js";
import {
  getDefaultMapExtractionConfig,
  readMapExtractionSummaryIfExists,
  runMapExtraction
} from "../services/mapExtractionService.js";
import {
  listMapEditorSnapshots,
  readLatestMapEditorSnapshot,
  readMapEditorSnapshot,
  readPreviousMapEditorSnapshot,
  saveMapEditorSnapshot,
  transferMapEditorSnapshot
} from "../services/mapEditorSnapshotService.js";
import {
  getCrawlJobById,
  getCrawlJobHistory,
  getCrawlOptions,
  getCurrentCrawlJob,
  startCrawlJob
} from "../services/crawlJobService.js";
import { formatDurationMs, logError, logInfo, logStep, logSubStep, logSuccess, logWarn } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");

const app = express();

function parseImagePaths(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue;
  }

  if (!rawValue) {
    return [];
  }

  if (typeof rawValue === "string") {
    try {
      const parsed = JSON.parse(rawValue);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function getPublicBaseUrl(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || req.protocol || "http";
  const host = req.get("host") || `${config.api.host}:${config.api.port}`;
  return `${proto}://${host}`;
}

function toPublicImageUrls(req, imagePaths) {
  const baseUrl = getPublicBaseUrl(req).replace(/\/$/, "");
  return imagePaths.map((imagePath) => {
    const normalizedPath = String(imagePath || "").replace(/^\//, "");
    return `${baseUrl}/${normalizedPath}`;
  });
}

function normalizeCircle(req, row) {
  const localImagePaths = parseImagePaths(row.local_image_paths_json);
  return {
    ...row,
    local_image_paths: localImagePaths,
    local_image_urls: toPublicImageUrls(req, localImagePaths)
  };
}

function parseCorsOrigin(rawValue) {
  if (!rawValue || rawValue === "*") {
    return "*";
  }

  return rawValue
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getRuntimeMapExtractionConfig() {
  return {
    pdfPath: path.join(projectRoot, config.map.pdfPath),
    outputDir: path.join(projectRoot, config.map.extractionOutputDir),
    dpi: config.map.extractionDpi
  };
}

function getTransferredMapRoot() {
  return path.join(projectRoot, "storage", "map");
}

function getOsmRoot() {
  return path.join(projectRoot, "storage", "osm");
}

function getOverlayTransformsPath() {
  return path.join(getTransferredMapRoot(), "overlay-transforms.json");
}

async function listOsmFilesRecursive(directory, root = directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listOsmFilesRecursive(absolutePath, root);
    }
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".osm") {
      return [];
    }
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
    return [{ path: relativePath, label: relativePath }];
  }));
  return files.flat().sort((left, right) => left.path.localeCompare(right.path, undefined, { numeric: true }));
}

function resolveOsmFilePath(relativePath) {
  const osmRoot = getOsmRoot();
  const requestedPath = String(relativePath || "").replace(/\\/g, "/");
  if (!requestedPath || path.posix.isAbsolute(requestedPath) || requestedPath.split("/").includes("..") || path.extname(requestedPath).toLowerCase() !== ".osm") {
    return null;
  }

  const absolutePath = path.resolve(osmRoot, requestedPath);
  const relativeToRoot = path.relative(osmRoot, absolutePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return null;
  }
  return absolutePath;
}

function getImageExtension({ fileName, mimeType }) {
  const extension = path.extname(String(fileName || "")).replace(/[^A-Za-z0-9.]/g, "").toLowerCase();
  if (extension) {
    return extension;
  }

  const mimeExtensions = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg"
  };
  return mimeExtensions[String(mimeType || "").toLowerCase()] || ".bin";
}

async function readTransferredMapMeta() {
  const meta = JSON.parse(await fs.readFile(path.join(getTransferredMapRoot(), "meta.json"), "utf-8"));
  return {
    ...meta,
    pageFiles: Array.isArray(meta.pageFiles) ? meta.pageFiles.filter((pageFile) => /^page-\d+\.json$/.test(String(pageFile || ""))) : []
  };
}

async function queryFavoriteCircles(req, { q, limit, offset }) {
  const whereParams = [];
  let whereClause = "";

  if (q) {
    const keyword = `%${q}%`;
    whereClause = `
      WHERE circle_id LIKE ?
         OR circle_name LIKE ?
         OR booth_location LIKE ?
         OR author_name LIKE ?
         OR genre LIKE ?
         OR tags_text LIKE ?
         OR pixiv_id LIKE ?
         OR twitter_id LIKE ?
    `;
    whereParams.push(keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword);
  }

  const [rows] = await pool.query(
    `
      SELECT
        id,
        circle_id,
        color_index,
        booth_location,
        circle_name,
        author_name,
        genre,
        memo,
        pixiv_id,
        twitter_id,
        tags_text,
        supplement_text,
        local_image_paths_json,
        updated_at
      FROM favorite_circles
      ${whereClause}
      ORDER BY updated_at DESC, circle_id DESC
      LIMIT ? OFFSET ?
    `,
    [...whereParams, limit, offset]
  );

  const [countRows] = await pool.query(
    `
      SELECT COUNT(*) AS total
      FROM favorite_circles
      ${whereClause}
    `,
    whereParams
  );

  return {
    rows: rows.map((row) => normalizeCircle(req, row)),
    total: Number(countRows[0]?.total || 0)
  };
}

app.use(cors({ origin: parseCorsOrigin(config.api.corsOrigin) }));
app.use(express.json({ limit: "100mb" }));
app.use("/storage", express.static(path.join(projectRoot, "storage")));

app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) {
    return next();
  }

  const startedAt = process.hrtime.bigint();
  const requestLine = `${req.method} ${req.originalUrl}`;
  logStep(`API Request ${requestLine}`);

  res.on("finish", () => {
    const details = `status=${res.statusCode} | ${formatDurationMs(startedAt)}`;
    if (res.statusCode >= 500) {
      logWarn(`API Response ${requestLine}`, details);
      return;
    }
    logSuccess(`API Response ${requestLine}`, details);
  });

  next();
});

app.get("/api/health", async (_req, res) => {
  try {
    await testConnection();
    res.json({ ok: true });
  } catch (error) {
    logError("Health check failed", error);
    res.status(500).json({ ok: false, message: "database connection failed" });
  }
});

app.get("/api/crawl/options", (_req, res) => {
  res.json({ data: getCrawlOptions() });
});

app.post("/api/crawl/jobs", (req, res) => {
  try {
    const { job } = startCrawlJob(req.body || {});
    res.status(202).json({ data: job });
  } catch (error) {
    if (error?.code === "JOB_ALREADY_RUNNING") {
      return res.status(409).json({ message: error.message, data: getCurrentCrawlJob() });
    }

    if (error?.code === "INVALID_INPUT") {
      return res.status(400).json({ message: error.message });
    }

    logError("Start crawl job failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.get("/api/crawl/jobs/current", (_req, res) => {
  const currentJob = getCurrentCrawlJob();
  if (!currentJob) {
    return res.json({ data: null });
  }

  res.json({ data: currentJob });
});

app.get("/api/crawl/jobs", (req, res) => {
  const limit = Number(req.query.limit || 10);
  const jobs = getCrawlJobHistory(limit);
  res.json({ data: jobs });
});

app.get("/api/crawl/jobs/:jobId", (req, res) => {
  const job = getCrawlJobById(req.params.jobId);
  if (!job) {
    return res.status(404).json({ message: "job not found" });
  }

  res.json({ data: job });
});

app.get("/api/color-preferences", async (_req, res) => {
  try {
    const items = await getColorPreferences();
    res.json({ data: items });
  } catch (error) {
    logError("Get color preferences failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.put("/api/color-preferences", async (req, res) => {
  try {
    const items = req.body?.items;
    await saveColorPreferences(items);
    const updated = await getColorPreferences();
    res.json({ data: updated });
  } catch (error) {
    if (error?.code === "INVALID_INPUT") {
      return res.status(400).json({ message: error.message });
    }

    logError("Save color preferences failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.get("/api/map/extraction", async (_req, res) => {
  const startedAt = process.hrtime.bigint();
  try {
    logSubStep("Load map extraction defaults");
    const defaults = getDefaultMapExtractionConfig();

    logSubStep("Load existing extraction summary", defaults.summaryPath);
    const summary = await readMapExtractionSummaryIfExists({ summaryPath: defaults.summaryPath });
    if (!summary) {
      logWarn("Map extraction summary missing", defaults.summaryPath);
      return res.status(404).json({ message: "map extraction summary not found" });
    }

    logInfo(
      "  |- Map extraction read result",
      `pages=${summary.pageCount || 0} | booths=${summary.totalBooths || 0} | ${formatDurationMs(startedAt)}`
    );
    res.json({ data: summary });
  } catch (error) {
    logError("Read map extraction failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.post("/api/map/extraction", async (_req, res) => {
  const startedAt = process.hrtime.bigint();
  try {
    logSubStep("Prepare map extraction config");
    const summary = await runMapExtraction(getRuntimeMapExtractionConfig());

    logInfo(
      "  |- Map extraction regenerate result",
      `pages=${summary.pageCount || 0} | booths=${summary.totalBooths || 0} | ${formatDurationMs(startedAt)}`
    );
    res.json({ data: summary });
  } catch (error) {
    logError("Run map extraction failed", error);
    res.status(500).json({ message: error?.message || "internal server error" });
  }
});

app.get("/api/map/editor-snapshots", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const snapshots = await listMapEditorSnapshots({ limit });
    res.json({ data: snapshots });
  } catch (error) {
    logError("List map editor snapshots failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.get("/api/map/pages", async (_req, res) => {
  try {
    const meta = await readTransferredMapMeta();
    res.json({
      data: meta.pageFiles.map((pageFile) => {
        const page = Number(String(pageFile).match(/page-(\d+)\.json/)?.[1] || 0);
        return { page, pageFile, label: `Page ${page}` };
      }).filter((page) => page.page > 0)
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return res.status(404).json({ message: "transferred map not found" });
    }

    logError("List transferred map pages failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.get("/api/map/pages/:page", async (req, res) => {
  try {
    const page = Math.max(1, Math.round(Number(req.params.page || 0)));
    if (!page) {
      return res.status(400).json({ message: "page is required" });
    }

    const meta = await readTransferredMapMeta();
    const pageFile = `page-${page}.json`;
    if (!meta.pageFiles.includes(pageFile)) {
      return res.status(404).json({ message: "map page not found" });
    }

    const pageJson = JSON.parse(await fs.readFile(path.join(getTransferredMapRoot(), "pages", pageFile), "utf-8"));
    res.json({ data: pageJson });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return res.status(404).json({ message: "map page not found" });
    }

    logError("Read transferred map page failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.get("/api/osm/files", async (_req, res) => {
  try {
    res.json({ data: await listOsmFilesRecursive(getOsmRoot()) });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return res.status(404).json({ message: "osm folder not found" });
    }

    logError("List OSM files failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.get("/api/osm/file", async (req, res) => {
  try {
    const relativePath = String(req.query.path || "");
    const absolutePath = resolveOsmFilePath(relativePath);
    if (!absolutePath) {
      return res.status(400).json({ message: "valid .osm path is required" });
    }

    const content = await fs.readFile(absolutePath, "utf-8");
    res.json({ data: { path: relativePath.replace(/\\/g, "/"), content } });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return res.status(404).json({ message: "osm file not found" });
    }

    logError("Read OSM file failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.post("/api/maps", async (req, res) => {
  try {
    const objects = Array.isArray(req.body?.objects) ? req.body.objects : [];
    const assets = Array.isArray(req.body?.assets) ? req.body.assets : [];
    const now = new Date();
    const pad2 = (value) => String(value).padStart(2, "0");
    const saveId = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}-${Math.random().toString(36).slice(2, 8)}`;
    const mapsRoot = path.join(projectRoot, "storage", "maps");
    const imagesRoot = path.join(mapsRoot, "images");

    await fs.mkdir(imagesRoot, { recursive: true });

    const assetPathByObjectId = new Map();
    for (const asset of assets) {
      const objectId = String(asset?.objectId || "");
      const fileName = String(asset?.fileName || "image");
      const dataUrl = String(asset?.dataUrl || "");
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!objectId || !match) {
        continue;
      }

      const buffer = Buffer.from(match[2], "base64");
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      const extension = getImageExtension({ fileName, mimeType: match[1] });
      const libraryFileName = `${hash}${extension}`;
      const relativePath = path.posix.join("storage", "maps", "images", libraryFileName);
      const imagePath = path.join(imagesRoot, libraryFileName);
      try {
        await fs.writeFile(imagePath, buffer, { flag: "wx" });
      } catch (error) {
        if (error?.code !== "EEXIST") {
          throw error;
        }
      }
      assetPathByObjectId.set(objectId, relativePath);
    }

    const savedObjects = objects.map((object) => {
      const nextObject = {
        id: String(object?.id || ""),
        type: String(object?.type || ""),
        name: String(object?.name || ""),
        parentId: String(object?.parentId || ""),
        metadata: object?.metadata && typeof object.metadata === "object" ? object.metadata : {},
        transform: object?.transform && typeof object.transform === "object" ? object.transform : {}
      };
      if (object?.type === "image") {
        nextObject.imagePath = assetPathByObjectId.get(nextObject.id) || String(object?.imagePath || object?.imageUrl || "");
      }
      return nextObject;
    });

    const savePayload = {
      saveId,
      createdAt: now.toISOString(),
      objectCount: savedObjects.length,
      objects: savedObjects
    };
    const savePath = path.join(mapsRoot, `${saveId}.json`);
    await fs.writeFile(savePath, JSON.stringify(savePayload, null, 2), "utf-8");

    res.status(201).json({ data: { saveId, path: path.posix.join("storage", "maps", `${saveId}.json`), objectCount: savedObjects.length, objects: savedObjects } });
  } catch (error) {
    logError("Save editor2 map failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.get("/api/maps/latest", async (_req, res) => {
  try {
    const mapsRoot = path.join(projectRoot, "storage", "maps");
    const entries = await fs.readdir(mapsRoot, { withFileTypes: true });
    const jsonFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
    if (!jsonFiles.length) {
      return res.status(404).json({ message: "saved map not found" });
    }

    const candidates = (await Promise.all(jsonFiles.map(async (entry) => {
      const filePath = path.join(mapsRoot, entry.name);
      const parsed = JSON.parse(await fs.readFile(filePath, "utf-8"));
      return {
        ...parsed,
        path: path.posix.join("storage", "maps", entry.name),
        sortTime: Date.parse(parsed.createdAt || "") || 0
      };
    }))).sort((left, right) => right.sortTime - left.sortTime);

    res.json({ data: candidates[0] });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return res.status(404).json({ message: "saved map not found" });
    }

    logError("Load latest editor2 map failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.get("/api/map/editor-snapshots/latest", async (_req, res) => {
  try {
    const snapshot = await readLatestMapEditorSnapshot();
    if (!snapshot) {
      return res.status(404).json({ message: "map editor snapshot not found" });
    }

    res.json({ data: snapshot });
  } catch (error) {
    logError("Read latest map editor snapshot failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.get("/api/map/editor-snapshots/overlay-transforms", async (_req, res) => {
  try {
    const filePath = getOverlayTransformsPath();
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return res.json({ data: { pageOverlays: {}, pageEntities: {}, pageIslandLabelSettings: {} } });
    }
    res.json({ data: parsed });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return res.json({ data: { pageOverlays: {}, pageEntities: {}, pageIslandLabelSettings: {} } });
    }

    logError("Read map overlay transforms failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.put("/api/map/editor-snapshots/overlay-transforms", async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ message: "payload object is required" });
    }

    await fs.mkdir(getTransferredMapRoot(), { recursive: true });
    await fs.writeFile(getOverlayTransformsPath(), JSON.stringify(payload, null, 2), "utf-8");
    res.json({ data: payload });
  } catch (error) {
    logError("Save map overlay transforms failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.get("/api/map/editor-snapshots/previous", async (req, res) => {
  try {
    const saveId = String(req.query.saveId || "").trim();
    if (!saveId) {
      return res.status(400).json({ message: "saveId is required" });
    }

    const snapshot = await readPreviousMapEditorSnapshot({ saveId });
    if (!snapshot) {
      return res.status(404).json({ message: "previous map editor snapshot not found" });
    }

    res.json({ data: snapshot });
  } catch (error) {
    if (error?.code === "INVALID_INPUT") {
      return res.status(400).json({ message: error.message });
    }

    logError("Read previous map editor snapshot failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.get("/api/map/editor-snapshots/:saveId", async (req, res) => {
  try {
    const saveId = String(req.params.saveId || "").trim();
    if (!saveId) {
      return res.status(400).json({ message: "saveId is required" });
    }

    const snapshot = await readMapEditorSnapshot({ saveId });
    res.json({ data: snapshot });
  } catch (error) {
    if (error?.code === "INVALID_INPUT") {
      return res.status(400).json({ message: error.message });
    }

    if (error?.code === "ENOENT") {
      return res.status(404).json({ message: "map editor snapshot not found" });
    }

    logError("Read map editor snapshot failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.post("/api/map/editor-snapshots", async (req, res) => {
  try {
    const pages = req.body?.pages;
    const summary = req.body?.summary;
    const snapshot = await saveMapEditorSnapshot({ pages, summary });
    res.status(201).json({ data: snapshot });
  } catch (error) {
    if (error?.code === "INVALID_INPUT") {
      return res.status(400).json({ message: error.message });
    }

    logError("Save map editor snapshot failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.post("/api/map/editor-snapshots/transfer", async (req, res) => {
  try {
    const pages = req.body?.pages;
    const summary = req.body?.summary;
    const snapshot = await saveMapEditorSnapshot({ pages, summary });
    const transfer = await transferMapEditorSnapshot({ saveId: snapshot.saveId });
    res.status(201).json({ data: { ...snapshot, transfer } });
  } catch (error) {
    if (error?.code === "INVALID_INPUT") {
      return res.status(400).json({ message: error.message });
    }

    logError("Transfer map editor snapshot failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.get("/api/favorite-circles", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offsetFromPage = (page - 1) * limit;
    const offset = Math.max(Number(req.query.offset) || offsetFromPage, 0);

    const result = await queryFavoriteCircles(req, { q, limit, offset });

    res.json({
      data: result.rows,
      pagination: {
        total: result.total,
        limit,
        offset,
        page: Math.floor(offset / limit) + 1
      }
    });
  } catch (error) {
    logError("List favorite circles failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.get("/api/favorite-circles/:circleId", async (req, res) => {
  try {
    const circleId = String(req.params.circleId || "").trim();
    if (!circleId) {
      return res.status(400).json({ message: "circleId is required" });
    }

    const [rows] = await pool.query(
      `
        SELECT
          id,
          circle_id,
          color_index,
          booth_location,
          circle_name,
          author_name,
          genre,
          memo,
          pixiv_id,
          twitter_id,
          tags_text,
          supplement_text,
          local_image_paths_json,
          updated_at
        FROM favorite_circles
        WHERE circle_id = ?
        LIMIT 1
      `,
      [circleId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "circle not found" });
    }

    res.json({ data: normalizeCircle(req, rows[0]) });
  } catch (error) {
    logError("Get favorite circle failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

app.get("/api/favorite-circles/:circleId/images", async (req, res) => {
  try {
    const circleId = String(req.params.circleId || "").trim();
    if (!circleId) {
      return res.status(400).json({ message: "circleId is required" });
    }

    const [rows] = await pool.query(
      `
        SELECT circle_id, local_image_paths_json
        FROM favorite_circles
        WHERE circle_id = ?
        LIMIT 1
      `,
      [circleId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "circle not found" });
    }

    const localImagePaths = parseImagePaths(rows[0].local_image_paths_json);
    const imageUrls = toPublicImageUrls(req, localImagePaths);

    res.json({
      data: {
        circle_id: rows[0].circle_id,
        local_image_paths: localImagePaths,
        local_image_urls: imageUrls
      }
    });
  } catch (error) {
    logError("Get circle images failed", error);
    res.status(500).json({ message: "internal server error" });
  }
});

async function start() {
  logStep("Ensuring schema for API");
  await ensureSchema();
  await testConnection();

  app.listen(config.api.port, config.api.host, () => {
    logSuccess("API server started", `http://${config.api.host}:${config.api.port}`);
    logInfo(
      "Available endpoints",
      "/api/health, /api/favorite-circles, /api/favorite-circles/:circleId, /api/favorite-circles/:circleId/images, /api/crawl/options, /api/crawl/jobs, /api/color-preferences, /api/map/extraction, /api/map/editor-snapshots, /api/osm/files, /api/osm/file"
    );
  });
}

start().catch((error) => {
  logError("Failed to start API server", error);
  process.exit(1);
});
