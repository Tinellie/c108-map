import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logSubStep, logSuccess } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const defaultSnapshotRoot = path.join(projectRoot, "storage", "map_extracted", "edits");
const defaultTransferRoot = path.join(projectRoot, "storage", "map");

function pad2(value) {
  return String(value).padStart(2, "0");
}

function createSaveId() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  const random = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${random}`;
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

async function writeJsonFile(filePath, payload) {
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

function asFiniteNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function roundCoordinate(value) {
  return Math.round(asFiniteNumber(value, 0) * 1000) / 1000;
}

function normalizeRect(rawRect) {
  if (!rawRect || typeof rawRect !== "object") {
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  return {
    x: Math.round(asFiniteNumber(rawRect.x, 0)),
    y: Math.round(asFiniteNumber(rawRect.y, 0)),
    w: Math.max(0, Math.round(asFiniteNumber(rawRect.w, 0))),
    h: Math.max(0, Math.round(asFiniteNumber(rawRect.h, 0)))
  };
}

function normalizeHall(hall) {
  if (!hall || typeof hall !== "object") {
    return null;
  }

  const hallId = String(hall.hallId || hall.hall_id || "").trim();
  if (!hallId) {
    return null;
  }

  return {
    hallId,
    islandIds: Array.isArray(hall.islandIds) ? hall.islandIds.map((value) => String(value || "")).filter(Boolean) : [],
    x: roundCoordinate(hall.x),
    y: roundCoordinate(hall.y),
    w: Math.max(1, Math.round(asFiniteNumber(hall.w, 1))),
    h: Math.max(1, Math.round(asFiniteNumber(hall.h, 1))),
    rotation: asFiniteNumber(hall.rotation, 0),
    backgroundImagePath: String(hall.backgroundImagePath || hall.background_image_path || ""),
    backgroundImageSourcePath: String(hall.backgroundImageSourcePath || hall.background_image_source_path || ""),
    backgroundOffsetX: asFiniteNumber(hall.backgroundOffsetX ?? hall.background_offset_x, 0),
    backgroundOffsetY: asFiniteNumber(hall.backgroundOffsetY ?? hall.background_offset_y, 0)
  };
}

function normalizeMapEntityBase(entity, type) {
  if (!entity || typeof entity !== "object") {
    return null;
  }

  const id = String(entity.id || entity.hallId || "").trim();
  if (!id) {
    return null;
  }

  return {
    id,
    type,
    parentId: String(entity.parentId || ""),
    x: roundCoordinate(entity.x),
    y: roundCoordinate(entity.y)
  };
}

function sanitizeMapEntities(rawEntities) {
  const entities = rawEntities && typeof rawEntities === "object" ? rawEntities : {};
  return {
    booths: (Array.isArray(entities.booths) ? entities.booths : [])
      .map((entity) => {
        const base = normalizeMapEntityBase(entity, "booth");
        if (!base || Boolean(entity.excluded)) {
          return null;
        }
        return {
          ...base,
          page: Math.max(1, Math.round(asFiniteNumber(entity.page, 1))),
          w: Math.max(1, Math.round(asFiniteNumber(entity.w, 1))),
          h: Math.max(1, Math.round(asFiniteNumber(entity.h, 1))),
          boothNumber: String(entity.boothNumber ?? entity.booth_number ?? ""),
          boothSuffix: String(entity.boothSuffix ?? entity.booth_suffix ?? ""),
          splitIndex: Math.max(0, Math.round(asFiniteNumber(entity.splitIndex ?? entity.split_index, 0)))
        };
      })
      .filter(Boolean),
    groups: (Array.isArray(entities.groups) ? entities.groups : [])
      .map((entity) => normalizeMapEntityBase(entity, "group"))
      .filter(Boolean),
    islands: (Array.isArray(entities.islands) ? entities.islands : [])
      .map((entity) => {
        const base = normalizeMapEntityBase(entity, "island");
        return base ? { ...base, raw: String(entity.raw ?? entity.islandRaw ?? "") } : null;
      })
      .filter(Boolean),
    halls: (Array.isArray(entities.halls) ? entities.halls : [])
      .map((entity) => {
        const base = normalizeMapEntityBase(entity, "hall");
        return base ? {
          ...base,
          rotation: asFiniteNumber(entity.rotation, 0),
          backgroundImagePath: String(entity.backgroundImagePath || entity.background_image_path || ""),
          backgroundOffsetX: roundCoordinate(entity.backgroundOffsetX ?? entity.background_offset_x),
          backgroundOffsetY: roundCoordinate(entity.backgroundOffsetY ?? entity.background_offset_y),
          trim: Math.max(0, Math.round(asFiniteNumber(entity.trim, 0)))
        } : null;
      })
      .filter(Boolean)
  };
}

function getHallCenter(hall) {
  return {
    x: hall.x + hall.w / 2,
    y: hall.y + hall.h / 2
  };
}

function rotatePoint(point, center, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  const translatedX = point.x - center.x;
  const translatedY = point.y - center.y;

  return {
    x: center.x + translatedX * cos - translatedY * sin,
    y: center.y + translatedX * sin + translatedY * cos
  };
}

function hallLocalRectToWorldRect(rect, hall) {
  if (!rect || !hall) {
    return rect || null;
  }

  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h }
  ];
  const center = getHallCenter(hall);
  const transformed = corners.map((corner) => rotatePoint({ x: hall.x + corner.x, y: hall.y + corner.y }, center, hall.rotation || 0));
  const xs = transformed.map((corner) => corner.x);
  const ys = transformed.map((corner) => corner.y);

  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    h: Math.max(1, Math.max(...ys) - Math.min(...ys))
  };
}

function hallWorldRectToLocalRect(rect, hall) {
  if (!rect || !hall) {
    return rect || null;
  }

  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h }
  ];
  const center = getHallCenter(hall);
  const radians = ((hall.rotation || 0) * Math.PI) / 180;
  const sin = Math.sin(-radians);
  const cos = Math.cos(-radians);
  const localCorners = corners.map((corner) => {
    const translatedX = corner.x - center.x;
    const translatedY = corner.y - center.y;
    const rotatedX = translatedX * cos - translatedY * sin;
    const rotatedY = translatedX * sin + translatedY * cos;
    return {
      x: rotatedX + center.x - hall.x,
      y: rotatedY + center.y - hall.y
    };
  });
  const xs = localCorners.map((corner) => corner.x);
  const ys = localCorners.map((corner) => corner.y);

  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    h: Math.max(1, Math.max(...ys) - Math.min(...ys))
  };
}

function sanitizeBooth(booth) {
  if (!booth || typeof booth !== "object") {
    return null;
  }

  if (Boolean(booth.__sizeExcluded)) {
    return null;
  }

  const page = Math.max(1, Math.round(asFiniteNumber(booth.page, 1)));
  const splitIndex = Math.max(0, Math.round(asFiniteNumber(booth.split_index, 0)));
  const canonical = {
    page,
    booth_number: String(booth.booth_number || ""),
    booth_suffix: String(booth.booth_suffix || ""),
    bbox: normalizeRect(booth.bbox),
    split_index: splitIndex
  };

  const editor = {};
  if (typeof booth.__id === "string" && booth.__id) {
    editor.__id = booth.__id;
  }
  if (typeof booth.__groupId === "string" && booth.__groupId) {
    editor.__groupId = booth.__groupId;
  }
  if (typeof booth.__islandId === "string" && booth.__islandId) {
    editor.__islandId = booth.__islandId;
  }
  if (typeof booth.__hallId === "string" && booth.__hallId) {
    editor.__hallId = booth.__hallId;
  }

  const hasEditorState = Object.keys(editor).length > 0;
  return hasEditorState ? { ...canonical, editor } : canonical;
}

function sanitizePage(page) {
  const pageNo = Math.max(1, Math.round(asFiniteNumber(page?.page, 1)));
  if (page?.entities && typeof page.entities === "object") {
    const entities = sanitizeMapEntities(page.entities);
    return {
      page: pageNo,
      image: String(page?.image || `page-${pageNo}.png`),
      renderedImagePath: String(page?.renderedImagePath || ""),
      renderedImageWidth: Math.max(0, Math.round(asFiniteNumber(page?.renderedImageWidth ?? page?.rendered_image_width, 0))),
      renderedImageHeight: Math.max(0, Math.round(asFiniteNumber(page?.renderedImageHeight ?? page?.rendered_image_height, 0))),
      boothRectangleCount: Math.max(entities.booths.length, Math.round(asFiniteNumber(page?.boothRectangleCount, entities.booths.length))),
      boothCount: entities.booths.length,
      debugImagePath: String(page?.debugImagePath || ""),
      entities
    };
  }

  const halls = Array.isArray(page?.editor?.halls)
    ? page.editor.halls.map(normalizeHall).filter(Boolean)
    : [];
  const hallMap = new Map(halls.map((hall) => [hall.hallId, hall]));
  const booths = Array.isArray(page?.booths)
    ? page.booths.map((booth) => {
        const normalized = sanitizeBooth(booth);
        if (!normalized) {
          return null;
        }

        const hallId = normalized.editor?.__hallId || normalized.__hallId;
        const hall = hallId ? hallMap.get(hallId) : null;
        if (!hall) {
          return normalized;
        }

        return {
          ...normalized,
          bbox: hallWorldRectToLocalRect(normalized.bbox, hall)
        };
      }).filter(Boolean)
    : [];

  const islandLabels = page?.editor?.islandLabels && typeof page.editor.islandLabels === "object"
    ? Object.fromEntries(
      Object.entries(page.editor.islandLabels)
        .map(([islandId, label]) => [String(islandId || "").trim(), String(label || "")])
        .filter(([islandId]) => Boolean(islandId))
    )
    : {};

  const editor = Object.keys(islandLabels).length ? { islandLabels } : null;

  return {
    page: pageNo,
    image: String(page?.image || `page-${pageNo}.png`),
    renderedImagePath: String(page?.renderedImagePath || ""),
    renderedImageWidth: Math.max(0, Math.round(asFiniteNumber(page?.renderedImageWidth ?? page?.rendered_image_width, 0))),
    renderedImageHeight: Math.max(0, Math.round(asFiniteNumber(page?.renderedImageHeight ?? page?.rendered_image_height, 0))),
    boothRectangleCount: Math.max(booths.length, Math.round(asFiniteNumber(page?.boothRectangleCount, booths.length))),
    boothCount: booths.length,
    debugImagePath: String(page?.debugImagePath || ""),
    booths,
    ...(editor || halls.length ? { editor: { ...(editor || {}), ...(halls.length ? { halls } : {}) } } : {})
  };
}

function sanitizeSummaryMeta(summary) {
  if (!summary || typeof summary !== "object") {
    return null;
  }

  return {
    sourcePdfPath: summary.sourcePdfPath || "",
    renderDpi: Number(summary.renderDpi || 0),
    startPage: Number(summary.startPage || 0),
    endPage: Number(summary.endPage || 0),
    outputRoot: summary.outputRoot || ""
  };
}

function byCreatedDesc(a, b) {
  const left = Date.parse(a.createdAt || "") || 0;
  const right = Date.parse(b.createdAt || "") || 0;
  return right - left;
}

async function readSnapshotMeta(snapshotDir, saveId) {
  try {
    const metaPath = path.join(snapshotDir, "meta.json");
    const parsed = await readJsonFile(metaPath);
    return {
      saveId,
      ...parsed
    };
  } catch {
    return null;
  }
}

function validateSaveId(saveId) {
  if (!/^[A-Za-z0-9_-]+$/.test(saveId || "")) {
    const error = new Error("invalid saveId");
    error.code = "INVALID_INPUT";
    throw error;
  }
}

export async function saveMapEditorSnapshot({ pages, summary, snapshotRoot = defaultSnapshotRoot } = {}) {
  if (!Array.isArray(pages) || pages.length === 0) {
    const error = new Error("pages is required");
    error.code = "INVALID_INPUT";
    throw error;
  }

  const saveId = createSaveId();
  const createdAt = new Date().toISOString();
  const snapshotDir = path.join(snapshotRoot, saveId);
  const pagesDir = path.join(snapshotDir, "pages");

  await fs.mkdir(pagesDir, { recursive: true });

  const sanitizedPages = pages
    .map(sanitizePage)
    .filter((page) => Number.isFinite(Number(page?.page)));

  const pageFiles = sanitizedPages.map((page) => `page-${Number(page.page)}.json`);
  const totalBooths = sanitizedPages.reduce((sum, page) => sum + Number(page.boothCount || page.booths?.length || page.entities?.booths?.length || 0), 0);

  await Promise.all(
    sanitizedPages.map((page, index) =>
      writeJsonFile(path.join(pagesDir, pageFiles[index]), page)
    )
  );

  const meta = {
    saveId,
    createdAt,
    pageCount: sanitizedPages.length,
    totalBooths,
    pageFiles,
    summaryMeta: sanitizeSummaryMeta(summary)
  };

  await writeJsonFile(path.join(snapshotDir, "meta.json"), meta);

  logSuccess("Map editor snapshot saved", `saveId=${saveId} | pages=${meta.pageCount} | booths=${meta.totalBooths}`);
  return meta;
}

export async function transferMapEditorSnapshot({ saveId, snapshotRoot = defaultSnapshotRoot, transferRoot = defaultTransferRoot } = {}) {
  validateSaveId(saveId);

  const sourceDir = path.join(snapshotRoot, saveId);
  const targetDir = transferRoot;

  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });
  await fs.cp(sourceDir, targetDir, { recursive: true });

  logSuccess("Map editor snapshot transferred", `saveId=${saveId} | target=${targetDir}`);
  return {
    saveId,
    targetPath: path.relative(projectRoot, targetDir).replace(/\\/g, "/")
  };
}

export async function listMapEditorSnapshots({ snapshotRoot = defaultSnapshotRoot, limit = 20 } = {}) {
  try {
    await fs.mkdir(snapshotRoot, { recursive: true });
    const entries = await fs.readdir(snapshotRoot, { withFileTypes: true });
    const dirs = entries.filter((entry) => entry.isDirectory());

    const metas = (await Promise.all(
      dirs.map((dirEntry) => {
        const saveId = dirEntry.name;
        const snapshotDir = path.join(snapshotRoot, saveId);
        return readSnapshotMeta(snapshotDir, saveId);
      })
    )).filter(Boolean);

    return metas.sort(byCreatedDesc).slice(0, Math.max(1, Number(limit) || 20));
  } catch {
    return [];
  }
}

export async function readMapEditorSnapshot({ saveId, snapshotRoot = defaultSnapshotRoot } = {}) {
  validateSaveId(saveId);

  const snapshotDir = path.join(snapshotRoot, saveId);
  const metaPath = path.join(snapshotDir, "meta.json");
  logSubStep("Read map editor snapshot meta", metaPath);

  const meta = await readJsonFile(metaPath);
  const pageFiles = Array.isArray(meta.pageFiles) ? meta.pageFiles : [];

  const pages = await Promise.all(
    pageFiles.map((pageFile) => readJsonFile(path.join(snapshotDir, "pages", pageFile)))
  );

  pages.sort((a, b) => Number(a.page || 0) - Number(b.page || 0));

  return {
    ...meta,
    pages
  };
}

export async function readLatestMapEditorSnapshot({ snapshotRoot = defaultSnapshotRoot } = {}) {
  const snapshots = await listMapEditorSnapshots({ snapshotRoot, limit: 1 });
  if (!snapshots.length) {
    return null;
  }

  return readMapEditorSnapshot({ saveId: snapshots[0].saveId, snapshotRoot });
}

export async function readPreviousMapEditorSnapshot({ saveId, snapshotRoot = defaultSnapshotRoot } = {}) {
  validateSaveId(saveId);
  const snapshots = await listMapEditorSnapshots({ snapshotRoot, limit: Number.MAX_SAFE_INTEGER });
  const currentIndex = snapshots.findIndex((snapshot) => snapshot.saveId === saveId);
  if (currentIndex < 0 || currentIndex >= snapshots.length - 1) {
    return null;
  }

  return readMapEditorSnapshot({ saveId: snapshots[currentIndex + 1].saveId, snapshotRoot });
}
