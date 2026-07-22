import { useEffect, useMemo, useRef, useState } from "react";
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Checkbox, FormControl, FormControlLabel, InputLabel, List, ListItem, ListItemIcon, ListItemText, MenuItem, Paper, Select, Slider, Stack, TextField, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import railwayRHtml from "../statics/railway-r.html?raw";
import railwayUHtml from "../statics/railway-u.html?raw";
import { badgeColor, COLOR_LABELS, fetchAllCirclesFromApi, getDayCategory, normalizeCircle, parseLocation } from "../utils/viewerUtils";
import { withApiBaseUrl } from "../utils/apiBase.js";
import { CircleDetailDrawer } from "../components/CircleDetailDrawer";

const OSM_FILE_API = withApiBaseUrl("/api/osm/file");
const MAP_EDITOR_SNAPSHOTS_API = withApiBaseUrl("/api/map/editor-snapshots");
const MAP_PAGES_API = withApiBaseUrl("/api/map/pages");
const FAVORITE_CIRCLES_API = withApiBaseUrl("/api/favorite-circles");
const STORAGE_BASE_URL = import.meta.env.VITE_STORAGE_BASE_URL || withApiBaseUrl("");
const EDITOR_OVERLAY_STORAGE_KEY = "osm-map-editor-overlay-transforms";
const OSM_MAP_LOCAL_FILTERS_STORAGE_KEY = "osm-map-local-filters";
const LOCKED_OSM_FILE = "8__.osm";
const GRID_WORLD_STEP = 100;
const HIGHWAY_TOP_LAYER = 100;
const HALL_TOP_LAYER = 20;
const STATION_MARKER_SCALES = {
  rinkai: 0.34,
  yurikamome: 0.24
};
const PATH_HIGHLIGHT_OPTIONS = [
  { id: "e-entry", tagKey: "path:e-entry", label: "东侧待机列", color: "#ff2b2b", fillColor: "rgba(255, 115, 115, 0.28)" },
  { id: "s-entry", tagKey: "path:s-entry", label: "西南待机列", color: "#1c55ff", fillColor: "rgba(121, 158, 255, 0.28)" },
  { id: "e-to-s", tagKey: "path:e-to-s", label: "东-南连络通道", color: "#1c55ff", fillColor: "rgba(121, 158, 255, 0.28)" },
  { id: "s-to-e", tagKey: "path:s-to-e", label: "南-东连络通道", color: "#ff2b2b", fillColor: "rgba(255, 115, 115, 0.28)" }
];
const EDITOR_ENTITY_STYLE = {
  hall: { stroke: "rgba(242, 133, 49, 0.9)", fill: "rgba(252, 181, 112, 0.06)" },
  island: { stroke: "rgba(126, 83, 230, 0.9)", fill: "rgba(196, 166, 255, 0.08)" },
  group: { stroke: "rgba(56, 150, 70, 0.9)", fill: "rgba(124, 208, 132, 0.08)" },
  booth: { stroke: "rgba(112, 116, 122, 0.9)", fill: "rgba(156, 162, 170, 0.24)" }
};
const EDITOR_OVERLAY_DEFAULT = { x: 0, y: 0, scale: 0.12 };
const EDITOR_OVERLAY_NUDGE = 10;
const USER_MODE_DEFAULT_LEVELS = [1, 2];
const ISLAND_LABEL_SIDE_OPTIONS = ["top", "right", "bottom", "left", "center"];
const DEFAULT_ISLAND_LABEL_SETTING = { side: "top", offsetX: 0, offsetY: 0 };
const COLOR_INDEX_OPTIONS = Object.keys(COLOR_LABELS)
  .map((key) => Number(key))
  .filter((value) => Number.isFinite(value))
  .sort((left, right) => left - right);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSignedDegrees(value) {
  const normalized = ((Number(value) % 360) + 360) % 360;
  return normalized > 180 ? normalized - 360 : normalized;
}

function extractNorthHeadingDegrees(event) {
  const compassHeading = Number(event?.webkitCompassHeading);
  if (Number.isFinite(compassHeading)) {
    return ((compassHeading % 360) + 360) % 360;
  }

  const alpha = Number(event?.alpha);
  if (!Number.isFinite(alpha)) {
    return null;
  }

  // Some Android browsers report absolute=false even when alpha is usable.
  return ((360 - alpha) % 360 + 360) % 360;
}

async function readJson(response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.message || `Request failed (${response.status})`);
  }
  return json;
}

function toWorldPoint(point, viewState) {
  const centerX = asFiniteNumber(viewState?.viewportWidth, 0) > 0
    ? asFiniteNumber(viewState.viewportWidth, 0) / 2
    : asFiniteNumber(viewState?.offsetX, 0);
  const centerY = asFiniteNumber(viewState?.viewportHeight, 0) > 0
    ? asFiniteNumber(viewState.viewportHeight, 0) / 2
    : asFiniteNumber(viewState?.offsetY, 0);
  const rotationRad = (asFiniteNumber(viewState?.rotationDeg, 0) * Math.PI) / 180;
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  const zoom = normalizeScale(viewState?.zoom);
  const rotatedX = point.x - centerX;
  const rotatedY = point.y - centerY;
  const localX = (rotatedX * cos) + (rotatedY * sin);
  const localY = (-rotatedX * sin) + (rotatedY * cos);
  return {
    x: (localX - asFiniteNumber(viewState?.offsetX, 0) + centerX) / zoom,
    y: (localY - asFiniteNumber(viewState?.offsetY, 0) + centerY) / zoom
  };
}

function toScreenPoint(point, viewState) {
  const centerX = asFiniteNumber(viewState?.viewportWidth, 0) > 0
    ? asFiniteNumber(viewState.viewportWidth, 0) / 2
    : asFiniteNumber(viewState?.offsetX, 0);
  const centerY = asFiniteNumber(viewState?.viewportHeight, 0) > 0
    ? asFiniteNumber(viewState.viewportHeight, 0) / 2
    : asFiniteNumber(viewState?.offsetY, 0);
  const rotationRad = (asFiniteNumber(viewState?.rotationDeg, 0) * Math.PI) / 180;
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  const zoom = normalizeScale(viewState?.zoom);
  const localX = (point.x * zoom) + asFiniteNumber(viewState?.offsetX, 0) - centerX;
  const localY = (point.y * zoom) + asFiniteNumber(viewState?.offsetY, 0) - centerY;
  return {
    x: centerX + localX * cos - localY * sin,
    y: centerY + localX * sin + localY * cos
  };
}

function addTagValue(tags, key, value) {
  if (!key || value === undefined || value === null) {
    return;
  }
  if (tags[key] === undefined) {
    tags[key] = String(value);
    return;
  }
  const currentValues = Array.isArray(tags[key]) ? tags[key].map(String) : [String(tags[key])];
  if (!currentValues.includes(String(value))) {
    tags[key] = [...currentValues, String(value)];
  }
}

function mergeTags(...tagSets) {
  const mergedTags = {};
  tagSets.forEach((tagSet) => {
    Object.entries(tagSet || {}).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item) => addTagValue(mergedTags, key, item));
        return;
      }
      addTagValue(mergedTags, key, value);
    });
  });
  return mergedTags;
}

function getTagValues(tags, key) {
  const value = tags[key];
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function hasTag(tags, key) {
  return getTagValues(tags, key).length > 0;
}

function hasTagValue(tags, key, expectedValue) {
  return getTagValues(tags, key).includes(String(expectedValue));
}

function hasPathTagKey(tags) {
  return Object.keys(tags || {}).some((key) => /^path:.+/.test(key));
}

function getNumericTag(tags, key, fallback = 0) {
  const numericValue = getTagValues(tags, key)
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value));
  return numericValue ?? fallback;
}

function getDisplayLevel(tags) {
  const level = getNumericTag(tags, "level", 1);
  return level === 0 ? 1 : level;
}

function isClosedWay(way) {
  if (way.points.length < 3) {
    return false;
  }
  const first = way.points[0];
  const last = way.points[way.points.length - 1];
  return first.x === last.x && first.y === last.y;
}

function drawWayPath(context, way) {
  context.moveTo(way.points[0].x, way.points[0].y);
  way.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
}

function asFiniteNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function roundCoordinate(value) {
  return Math.round(asFiniteNumber(value, 0) * 1000) / 1000;
}

function toFullwidthLatin(value) {
  return String(value || "").replace(/[A-Za-z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0xFEE0));
}

function toHalfwidthLatin(value) {
  return String(value || "").replace(/[Ａ-Ｚａ-ｚ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0));
}

function normalizeScale(value) {
  const next = asFiniteNumber(value, 1);
  return Math.abs(next) < 0.0001 ? 1 : next;
}

function degreesToRadians(degrees) {
  return asFiniteNumber(degrees, 0) * Math.PI / 180;
}

function transformPoint(transform, point) {
  const scale = normalizeScale(transform?.scale);
  const radians = degreesToRadians(transform?.rotation);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: asFiniteNumber(transform?.x, 0) + (point.x * scale * cos) - (point.y * scale * sin),
    y: asFiniteNumber(transform?.y, 0) + (point.x * scale * sin) + (point.y * scale * cos)
  };
}

function inverseTransformVector(transform, vector) {
  const scale = normalizeScale(transform?.scale);
  const radians = degreesToRadians(transform?.rotation);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: ((vector.x * cos) + (vector.y * sin)) / scale,
    y: ((vector.y * cos) - (vector.x * sin)) / scale
  };
}

function rectCorners(rect) {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h }
  ];
}

function expandRect(rect, amount) {
  const nextAmount = Math.max(0, asFiniteNumber(amount, 0));
  return {
    x: rect.x - nextAmount,
    y: rect.y - nextAmount,
    w: rect.w + nextAmount * 2,
    h: rect.h + nextAmount * 2
  };
}

function rectFromPoints(points) {
  const validPoints = points.filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!validPoints.length) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  const minX = Math.min(...validPoints.map((point) => point.x));
  const minY = Math.min(...validPoints.map((point) => point.y));
  const maxX = Math.max(...validPoints.map((point) => point.x));
  const maxY = Math.max(...validPoints.map((point) => point.y));
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function normalizeBoothEntity(entity) {
  return {
    id: String(entity?.id || ""),
    type: "booth",
    parentId: String(entity?.parentId || ""),
    x: roundCoordinate(entity?.x),
    y: roundCoordinate(entity?.y),
    rotation: asFiniteNumber(entity?.rotation, 0),
    scale: normalizeScale(entity?.scale),
    w: Math.max(1, Math.round(asFiniteNumber(entity?.w, 1))),
    h: Math.max(1, Math.round(asFiniteNumber(entity?.h, 1))),
    page: Math.max(1, Math.round(asFiniteNumber(entity?.page, 1))),
    boothNumber: String(entity?.boothNumber ?? entity?.booth_number ?? ""),
    boothSuffix: String(entity?.boothSuffix ?? entity?.booth_suffix ?? ""),
    excluded: Boolean(entity?.excluded)
  };
}

function normalizeGroupEntity(entity) {
  return {
    id: String(entity?.id || ""),
    type: "group",
    parentId: String(entity?.parentId || ""),
    x: roundCoordinate(entity?.x),
    y: roundCoordinate(entity?.y),
    rotation: asFiniteNumber(entity?.rotation, 0),
    scale: normalizeScale(entity?.scale)
  };
}

function normalizeIslandEntity(entity) {
  return {
    id: String(entity?.id || ""),
    type: "island",
    parentId: String(entity?.parentId || ""),
    x: roundCoordinate(entity?.x),
    y: roundCoordinate(entity?.y),
    rotation: asFiniteNumber(entity?.rotation, 0),
    scale: normalizeScale(entity?.scale),
    raw: toFullwidthLatin(String(entity?.raw ?? entity?.islandRaw ?? entity?.islandLabelRaw ?? ""))
  };
}

function normalizeHallEntity(entity) {
  return {
    id: String(entity?.id || entity?.hallId || ""),
    type: "hall",
    parentId: String(entity?.parentId || ""),
    x: roundCoordinate(entity?.x),
    y: roundCoordinate(entity?.y),
    rotation: asFiniteNumber(entity?.rotation, 0),
    scale: normalizeScale(entity?.scale)
  };
}

function normalizeEditorEntities(page) {
  if (!page?.entities || typeof page.entities !== "object") {
    return { booths: [], groups: [], islands: [], halls: [] };
  }
  return {
    booths: Array.isArray(page.entities.booths) ? page.entities.booths.map(normalizeBoothEntity).filter((entity) => entity.id) : [],
    groups: Array.isArray(page.entities.groups) ? page.entities.groups.map(normalizeGroupEntity).filter((entity) => entity.id) : [],
    islands: Array.isArray(page.entities.islands) ? page.entities.islands.map(normalizeIslandEntity).filter((entity) => entity.id) : [],
    halls: Array.isArray(page.entities.halls) ? page.entities.halls.map(normalizeHallEntity).filter((entity) => entity.id) : []
  };
}

function normalizeEditorPage(page) {
  const entities = normalizeEditorEntities(page);
  return {
    page: Math.max(1, Math.round(asFiniteNumber(page?.page, 1))),
    image: String(page?.image || `page-${page?.page || 1}.png`),
    entities
  };
}

function normalizeEditorOverlayTransform(transform) {
  return {
    x: roundCoordinate(transform?.x ?? EDITOR_OVERLAY_DEFAULT.x),
    y: roundCoordinate(transform?.y ?? EDITOR_OVERLAY_DEFAULT.y),
    scale: Math.max(0.005, roundCoordinate(transform?.scale ?? EDITOR_OVERLAY_DEFAULT.scale))
  };
}

function normalizeBoothLabelOffsets(offsets) {
  if (!offsets || typeof offsets !== "object") {
    return {};
  }
  const normalized = {};
  Object.entries(offsets).forEach(([key, value]) => {
    if (!key || !value || typeof value !== "object") {
      return;
    }
    const dx = asFiniteNumber(value.dx, Number.NaN);
    const dy = asFiniteNumber(value.dy, Number.NaN);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      return;
    }
    normalized[key] = {
      dx: roundCoordinate(dx),
      dy: roundCoordinate(dy)
    };
  });
  return normalized;
}

function normalizeUiPreferences(preferences) {
  if (!preferences || typeof preferences !== "object") {
    return {
      selectedCircleDay: "day1",
      selectedLabelColorIndexes: [...COLOR_INDEX_OPTIONS],
      selectedPathHighlightIds: [],
      selectedLevels: [...USER_MODE_DEFAULT_LEVELS],
      hiddenHallLabels: []
    };
  }

  const selectedCircleDay = String(preferences.selectedCircleDay || "day1");
  const selectedLabelColorIndexes = [...new Set(
    (Array.isArray(preferences.selectedLabelColorIndexes) ? preferences.selectedLabelColorIndexes : [])
      .map((value) => Number(value))
      .filter((value) => COLOR_INDEX_OPTIONS.includes(value))
  )].sort((left, right) => left - right);
  const selectedPathHighlightIds = [...new Set(
    (Array.isArray(preferences.selectedPathHighlightIds) ? preferences.selectedPathHighlightIds : [])
      .map((value) => String(value || "").trim())
      .filter((value) => PATH_HIGHLIGHT_OPTIONS.some((option) => option.id === value))
  )];
  const selectedLevels = [...new Set(
    (Array.isArray(preferences.selectedLevels) ? preferences.selectedLevels : [])
      .map((value) => Number(value))
      .filter((value) => [1, 2, 3, 4].includes(value))
  )].sort((left, right) => left - right);
  const hiddenHallLabels = [...new Set(
    (Array.isArray(preferences.hiddenHallLabels) ? preferences.hiddenHallLabels : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  return {
    selectedCircleDay: selectedCircleDay === "day2" ? "day2" : "day1",
    selectedLabelColorIndexes,
    selectedPathHighlightIds,
    selectedLevels,
    hiddenHallLabels
  };
}

function readLocalFilterPreferences() {
  if (typeof window === "undefined") {
    return { selectedLabelColorIndexes: [...COLOR_INDEX_OPTIONS] };
  }

  try {
    const saved = JSON.parse(window.localStorage.getItem(OSM_MAP_LOCAL_FILTERS_STORAGE_KEY) || "null");
    const selectedLabelColorIndexes = [...new Set(
      (Array.isArray(saved?.selectedLabelColorIndexes) ? saved.selectedLabelColorIndexes : COLOR_INDEX_OPTIONS)
        .map((value) => Number(value))
        .filter((value) => COLOR_INDEX_OPTIONS.includes(value))
    )].sort((left, right) => left - right);

    return {
      selectedLabelColorIndexes: selectedLabelColorIndexes.length ? selectedLabelColorIndexes : [...COLOR_INDEX_OPTIONS]
    };
  } catch {
    return { selectedLabelColorIndexes: [...COLOR_INDEX_OPTIONS] };
  }
}

function saveLocalFilterPreferences(preferences) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(OSM_MAP_LOCAL_FILTERS_STORAGE_KEY, JSON.stringify({
    selectedLabelColorIndexes: [...new Set(
      (Array.isArray(preferences?.selectedLabelColorIndexes) ? preferences.selectedLabelColorIndexes : [])
        .map((value) => Number(value))
        .filter((value) => COLOR_INDEX_OPTIONS.includes(value))
    )].sort((left, right) => left - right)
  }));
}

function readSavedEditorOverlayTransforms() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(EDITOR_OVERLAY_STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") {
      return { pageOverlays: {}, pageHalls: {}, pageIslandLabelSettings: {}, boothLabelOffsets: {}, uiPreferences: normalizeUiPreferences(null) };
    }
    return {
      pageOverlays: saved.pageOverlays && typeof saved.pageOverlays === "object" ? saved.pageOverlays : {},
      pageHalls: saved.pageHalls && typeof saved.pageHalls === "object" ? saved.pageHalls : {},
      // Keep a temporary legacy field for migration from old overlay payloads.
      pageEntities: saved.pageEntities && typeof saved.pageEntities === "object" ? saved.pageEntities : {},
      pageIslandLabelSettings: saved.pageIslandLabelSettings && typeof saved.pageIslandLabelSettings === "object" ? saved.pageIslandLabelSettings : {},
      boothLabelOffsets: normalizeBoothLabelOffsets(saved.boothLabelOffsets),
      uiPreferences: normalizeUiPreferences(saved.uiPreferences)
    };
  } catch {
    return { pageOverlays: {}, pageHalls: {}, pageIslandLabelSettings: {}, boothLabelOffsets: {}, uiPreferences: normalizeUiPreferences(null) };
  }
}

async function readSavedEditorOverlayTransformsFromApi() {
  try {
    const response = await fetch(`${MAP_EDITOR_SNAPSHOTS_API}/overlay-transforms`);
    const json = await readJson(response);
    const payload = json?.data;
    if (!payload || typeof payload !== "object") {
      return { pageOverlays: {}, pageHalls: {}, pageIslandLabelSettings: {}, boothLabelOffsets: {}, uiPreferences: normalizeUiPreferences(null) };
    }
    return {
      pageOverlays: payload.pageOverlays && typeof payload.pageOverlays === "object" ? payload.pageOverlays : {},
      pageHalls: payload.pageHalls && typeof payload.pageHalls === "object" ? payload.pageHalls : {},
      // Keep a temporary legacy field for migration from old overlay payloads.
      pageEntities: payload.pageEntities && typeof payload.pageEntities === "object" ? payload.pageEntities : {},
      pageIslandLabelSettings: payload.pageIslandLabelSettings && typeof payload.pageIslandLabelSettings === "object" ? payload.pageIslandLabelSettings : {},
      boothLabelOffsets: normalizeBoothLabelOffsets(payload.boothLabelOffsets),
      uiPreferences: normalizeUiPreferences(payload.uiPreferences)
    };
  } catch {
    return null;
  }
}

async function saveEditorOverlayTransformsToApi(payload) {
  const response = await fetch(`${MAP_EDITOR_SNAPSHOTS_API}/overlay-transforms`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  await readJson(response);
}

function applySavedEditorTransforms(pages, savedTransforms) {
  return pages.map((page) => {
    const savedHalls = savedTransforms.pageHalls?.[String(page.page)] || {};
    const legacySavedEntities = savedTransforms.pageEntities?.[String(page.page)] || {};
    const applyHallTransforms = (list) => list.map((entity) => {
      const savedEntity = savedHalls[entity.id] || legacySavedEntities[entity.id];
      if (!savedEntity) {
        return entity;
      }
      return {
        ...entity,
        x: roundCoordinate(savedEntity.x ?? entity.x),
        y: roundCoordinate(savedEntity.y ?? entity.y),
        rotation: roundCoordinate(savedEntity.rotation ?? entity.rotation),
        scale: Math.max(0.005, roundCoordinate(savedEntity.scale ?? entity.scale))
      };
    });
    return {
      ...page,
      entities: {
        booths: page.entities.booths || [],
        groups: page.entities.groups || [],
        islands: page.entities.islands || [],
        halls: applyHallTransforms(page.entities.halls || [])
      }
    };
  });
}

function buildEditorTransformPayload(pages, pageOverlays, pageIslandLabelSettings, boothLabelOffsets, uiPreferences) {
  return {
    savedAt: new Date().toISOString(),
    pageOverlays: Object.fromEntries(Object.entries(pageOverlays || {}).map(([pageNumber, transform]) => [pageNumber, normalizeEditorOverlayTransform(transform)])),
    pageHalls: Object.fromEntries((pages || []).map((page) => [
      String(page.page),
      Object.fromEntries((page.entities?.halls || []).map((hall) => [hall.id, {
        x: roundCoordinate(hall.x),
        y: roundCoordinate(hall.y),
        rotation: roundCoordinate(hall.rotation),
        scale: Math.max(0.005, roundCoordinate(hall.scale))
      }]))
    ])),
    pageIslandLabelSettings: Object.fromEntries(Object.entries(pageIslandLabelSettings || {}).map(([pageNumber, setting]) => [
      pageNumber,
      normalizeIslandLabelSetting(setting)
    ])),
    boothLabelOffsets: normalizeBoothLabelOffsets(boothLabelOffsets),
    uiPreferences: normalizeUiPreferences(uiPreferences)
  };
}

function flattenEditorEntities(entities) {
  return [
    ...(entities?.halls || []),
    ...(entities?.islands || []),
    ...(entities?.groups || []),
    ...(entities?.booths || [])
  ].filter((entity) => entity?.id);
}

function buildEditorEntityGraph(page) {
  const byId = new Map(flattenEditorEntities(page?.entities || {}).map((entity) => [entity.id, entity]));
  const childrenByParent = new Map();
  for (const entity of byId.values()) {
    if (!entity.parentId || !byId.has(entity.parentId)) {
      continue;
    }
    const list = childrenByParent.get(entity.parentId) || [];
    list.push(entity.id);
    childrenByParent.set(entity.parentId, list);
  }

  const getLocalTransform = (entity) => ({
    x: asFiniteNumber(entity?.x, 0),
    y: asFiniteNumber(entity?.y, 0),
    rotation: asFiniteNumber(entity?.rotation, 0),
    scale: normalizeScale(entity?.scale)
  });

  const worldTransformCache = new Map();
  const getWorldTransform = (entityId) => {
    if (worldTransformCache.has(entityId)) {
      return worldTransformCache.get(entityId);
    }
    const entity = byId.get(entityId);
    if (!entity) {
      return { x: 0, y: 0, rotation: 0, scale: 1 };
    }
    const parentTransform = entity.parentId && byId.has(entity.parentId)
      ? getWorldTransform(entity.parentId)
      : { x: 0, y: 0, rotation: 0, scale: 1 };
    const localTransform = getLocalTransform(entity);
    const origin = transformPoint(parentTransform, { x: localTransform.x, y: localTransform.y });
    const transform = {
      x: origin.x,
      y: origin.y,
      rotation: parentTransform.rotation + localTransform.rotation,
      scale: parentTransform.scale * localTransform.scale
    };
    worldTransformCache.set(entityId, transform);
    return transform;
  };

  const localRectCache = new Map();
  const getLocalRect = (entityId) => {
    if (localRectCache.has(entityId)) {
      return localRectCache.get(entityId);
    }
    const entity = byId.get(entityId);
    if (!entity) {
      return null;
    }
    const rect = entity.type === "booth"
      ? { x: 0, y: 0, w: Math.max(1, Math.round(entity.w)), h: Math.max(1, Math.round(entity.h)) }
      : rectFromPoints((childrenByParent.get(entityId) || []).flatMap((childId) => {
          const child = byId.get(childId);
          const childRect = getLocalRect(childId);
          return child && childRect ? rectCorners(childRect).map((point) => transformPoint(getLocalTransform(child), point)) : [];
        }));
    localRectCache.set(entityId, rect);
    return rect;
  };

  const getWorldPolygon = (entityId, pad = 0) => {
    const localRect = getLocalRect(entityId);
    const transform = getWorldTransform(entityId);
    const localPad = pad / Math.max(0.0001, Math.abs(normalizeScale(transform.scale)));
    return localRect ? rectCorners(expandRect(localRect, localPad)).map((point) => transformPoint(transform, point)) : [];
  };

  const getWorldRect = (entityId) => rectFromPoints(getWorldPolygon(entityId));
  const vectorToParentLocal = (parentId, vector) => parentId && byId.has(parentId)
    ? inverseTransformVector(getWorldTransform(parentId), vector)
    : vector;

  return { byId, getWorldPolygon, getWorldRect, vectorToParentLocal };
}

function transformEditorOverlayPoint(point, overlay) {
  return {
    x: overlay.x + point.x * overlay.scale,
    y: overlay.y + point.y * overlay.scale
  };
}

function drawPolygon(context, polygon) {
  polygon.forEach((point, index) => {
    if (index === 0) {
      context.moveTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
  });
}

function drawScreenAlignedText(context, text, x, y, fontSize, color, rotationDeg = 0) {
  const label = String(text || "").trim();
  if (!label) {
    return;
  }
  context.save();
  if (Math.abs(rotationDeg) > 0.0001) {
    context.translate(x, y);
    context.rotate((-rotationDeg * Math.PI) / 180);
    context.translate(-x, -y);
  }
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `${fontSize}px sans-serif`;
  context.fillText(label, x, y);
  context.restore();
}

function drawScreenAlignedOutlinedText(context, text, x, y, fontSize, fillColor, strokeColor, strokeWidth, rotationDeg = 0, extraRotationDeg = 0) {
  const label = String(text || "").trim();
  if (!label) {
    return;
  }
  context.save();
  context.translate(x, y);
  context.rotate(((-rotationDeg + extraRotationDeg) * Math.PI) / 180);
  context.fillStyle = fillColor;
  context.strokeStyle = strokeColor;
  context.lineWidth = strokeWidth;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `${fontSize}px "Noto Sans CJK TC", "Microsoft JhengHei", sans-serif`;
  context.strokeText(label, 0, 0);
  context.fillText(label, 0, 0);
  context.restore();
}

function normalizeIslandLabelSetting(setting) {
  const side = String(setting?.side || DEFAULT_ISLAND_LABEL_SETTING.side).toLowerCase();
  return {
    side: ISLAND_LABEL_SIDE_OPTIONS.includes(side) ? side : DEFAULT_ISLAND_LABEL_SETTING.side,
    offsetX: roundCoordinate(asFiniteNumber(setting?.offsetX, DEFAULT_ISLAND_LABEL_SETTING.offsetX)),
    offsetY: roundCoordinate(asFiniteNumber(setting?.offsetY, DEFAULT_ISLAND_LABEL_SETTING.offsetY))
  };
}

function getPolygonSideAnchor(polygon, side, distance = 0) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    return { x: 0, y: 0 };
  }
  const nextSide = String(side || "top").toLowerCase();
  const centroid = {
    x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
    y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length
  };
  if (nextSide === "center") {
    return centroid;
  }

  const sideIndexByName = {
    top: 0,
    right: 1,
    bottom: 2,
    left: 3
  };
  const edgeIndex = sideIndexByName[nextSide] ?? sideIndexByName.top;
  const start = polygon[edgeIndex % polygon.length];
  const end = polygon[(edgeIndex + 1) % polygon.length];
  const mid = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2
  };
  const out = {
    x: mid.x - centroid.x,
    y: mid.y - centroid.y
  };
  const outLength = Math.max(0.0001, Math.hypot(out.x, out.y));
  return {
    x: mid.x + (out.x / outLength) * distance,
    y: mid.y + (out.y / outLength) * distance
  };
}

function screenOffsetToCanvasUnits(offsetX, offsetY, rotationDeg) {
  const theta = (asFiniteNumber(rotationDeg, 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    x: (asFiniteNumber(offsetX, 0) * cos) + (asFiniteNumber(offsetY, 0) * sin),
    y: (-asFiniteNumber(offsetX, 0) * sin) + (asFiniteNumber(offsetY, 0) * cos)
  };
}

function normalizeBoothPairSuffix(value) {
  const suffix = String(value || "").trim().toLowerCase();
  return suffix === "a" || suffix === "b" ? suffix : "";
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 0.0001) {
    return null;
  }
  return { x: vector.x / length, y: vector.y / length };
}

function dotVector(a, b) {
  return a.x * b.x + a.y * b.y;
}

function projectPointToBasis(point, origin, axisU, axisV) {
  const delta = { x: point.x - origin.x, y: point.y - origin.y };
  return {
    u: dotVector(delta, axisU),
    v: dotVector(delta, axisV)
  };
}

function pointFromBasis(origin, axisU, axisV, u, v) {
  return {
    x: origin.x + axisU.x * u + axisV.x * v,
    y: origin.y + axisU.y * u + axisV.y * v
  };
}

function tryBuildMergedBoothPolygon(polygonA, polygonB) {
  if (!polygonA || !polygonB || polygonA.length < 4 || polygonB.length < 4) {
    return null;
  }
  const axisU = normalizeVector({ x: polygonA[1].x - polygonA[0].x, y: polygonA[1].y - polygonA[0].y });
  const axisV = normalizeVector({ x: polygonA[3].x - polygonA[0].x, y: polygonA[3].y - polygonA[0].y });
  const axisUB = normalizeVector({ x: polygonB[1].x - polygonB[0].x, y: polygonB[1].y - polygonB[0].y });
  const axisVB = normalizeVector({ x: polygonB[3].x - polygonB[0].x, y: polygonB[3].y - polygonB[0].y });
  if (!axisU || !axisV || !axisUB || !axisVB) {
    return null;
  }

  // Only merge booths that share almost the same orientation.
  if (Math.abs(dotVector(axisU, axisUB)) < 0.985 || Math.abs(dotVector(axisV, axisVB)) < 0.985) {
    return null;
  }

  const origin = polygonA[0];
  const allPoints = [...polygonA, ...polygonB];
  const projections = allPoints.map((point) => projectPointToBasis(point, origin, axisU, axisV));
  const minU = Math.min(...projections.map((projection) => projection.u));
  const maxU = Math.max(...projections.map((projection) => projection.u));
  const minV = Math.min(...projections.map((projection) => projection.v));
  const maxV = Math.max(...projections.map((projection) => projection.v));

  return [
    pointFromBasis(origin, axisU, axisV, minU, minV),
    pointFromBasis(origin, axisU, axisV, maxU, minV),
    pointFromBasis(origin, axisU, axisV, maxU, maxV),
    pointFromBasis(origin, axisU, axisV, minU, maxV)
  ];
}

function createRailwayStationMarker(node) {
  const ref = getTagValues(node.tags, "ref")[0] || "";
  if (!hasTagValue(node.tags, "railway", "station")) {
    return null;
  }
  const yurikamomeMatch = ref.match(/^U(\d+)$/i);
  const rinkaiMatch = ref.match(/^R(.+)$/i);
  const html = yurikamomeMatch
    ? railwayUHtml.replaceAll("[yurikamome]", yurikamomeMatch[1])
    : rinkaiMatch
      ? railwayRHtml.replaceAll("[rinkai]", rinkaiMatch[1])
      : "";
  const scale = yurikamomeMatch ? STATION_MARKER_SCALES.yurikamome : STATION_MARKER_SCALES.rinkai;
  if (!html) {
    return null;
  }
  return {
    id: node.id,
    x: node.x,
    y: node.y,
    ref,
    scale,
    html
  };
}

function getOnewayDirection(tags) {
  const values = getTagValues(tags, "oneway").map((value) => value.toLowerCase());
  if (values.includes("-1") || values.includes("reverse")) {
    return -1;
  }
  return values.some((value) => ["yes", "true", "1"].includes(value)) ? 1 : 0;
}

function applyAreaScopeStyle(style) {
  if (hasTag(style.tags, "tokyo-big-sight")) {
    return style;
  }
  return {
    ...style,
    stroke: style.stroke ? "rgba(116, 121, 125, 0.46)" : null,
    fill: style.fill ? "rgba(135, 139, 143, 0.18)" : null
  };
}

function isLevelFocused(level, selectedLevels) {
  return selectedLevels.length > 0 && selectedLevels.includes(Number(level));
}

function applyLevelFocusStyle(style, selectedLevels, forceVisible = false) {
  if (!selectedLevels.length || forceVisible || isLevelFocused(style.level, selectedLevels)) {
    return style;
  }
  return {
    ...style,
    stroke: style.stroke ? "rgba(120, 124, 128, 0.22)" : null,
    fill: style.fill ? "rgba(136, 140, 144, 0.08)" : null
  };
}

function getMergedWayTags(way) {
  return mergeTags(way.relationTags || {}, way.tags || {});
}

function getStepConnectorVisibleWayIds(ways, selectedLevels) {
  if (!selectedLevels.length) {
    return new Set();
  }

  const walkableLevelsByNodeId = new Map();
  ways.forEach((way) => {
    const tags = getMergedWayTags(way);
    const isWalkway = hasTagValue(tags, "highway", "footway")
      || hasTagValue(tags, "highway", "pedestrian")
      || hasTagValue(tags, "highway", "path");
    if (!isWalkway || !way.nodeRefs?.length) {
      return;
    }
    const level = getDisplayLevel(tags);
    way.nodeRefs.forEach((nodeId) => {
      if (!nodeId) {
        return;
      }
      const levels = walkableLevelsByNodeId.get(nodeId) || new Set();
      levels.add(level);
      walkableLevelsByNodeId.set(nodeId, levels);
    });
  });

  const selectedLevelSet = new Set(selectedLevels.map(Number));
  const visibleStepIds = new Set();
  ways.forEach((way) => {
    const tags = getMergedWayTags(way);
    if (!hasTagValue(tags, "highway", "steps") || !way.nodeRefs?.length) {
      return;
    }
    const startNodeId = way.nodeRefs[0];
    const endNodeId = way.nodeRefs[way.nodeRefs.length - 1];
    const startLevels = walkableLevelsByNodeId.get(startNodeId) || new Set();
    const endLevels = walkableLevelsByNodeId.get(endNodeId) || new Set();
    if (!startLevels.size || !endLevels.size) {
      return;
    }

    const startTouchesSelected = [...startLevels].some((level) => selectedLevelSet.has(level));
    const startTouchesOther = [...startLevels].some((level) => !selectedLevelSet.has(level));
    const endTouchesSelected = [...endLevels].some((level) => selectedLevelSet.has(level));
    const endTouchesOther = [...endLevels].some((level) => !selectedLevelSet.has(level));

    const bridgesAcrossSelectedAndOther = (startTouchesSelected && endTouchesOther)
      || (endTouchesSelected && startTouchesOther);
    if (bridgesAcrossSelectedAndOther) {
      visibleStepIds.add(way.id);
    }
  });

  return visibleStepIds;
}

function getPathHighlightStyle(tags, selectedPathHighlightIds) {
  if (!selectedPathHighlightIds.length) {
    return null;
  }
  const matchedOption = PATH_HIGHLIGHT_OPTIONS.find((option) => selectedPathHighlightIds.includes(option.id) && hasTag(tags, option.tagKey));
  if (!matchedOption) {
    return null;
  }
  const isSteps = hasTagValue(tags, "highway", "steps");
  return {
    color: matchedOption.color,
    fillColor: matchedOption.fillColor,
    lineDash: isSteps ? [1.2, 2.4] : []
  };
}

function getBuildingColors(tags) {
  if (hasTagValue(tags, "hall", "e")) {
    return {
      stroke: "rgba(192, 104, 104, 0.54)",
      fill: "rgba(238, 137, 137, 0.57)"
    };
  }
  if (hasTagValue(tags, "hall", "w")) {
    return {
      stroke: "rgba(88, 126, 188, 0.54)",
      fill: "rgba(136, 183, 248, 0.38)"
    };
  }
  if (hasTagValue(tags, "hall", "s")) {
    return {
      stroke: "rgba(93, 156, 122, 0.54)",
      fill: "rgba(127, 228, 162, 0.32)"
    };
  }
  return {
    stroke: "rgba(174, 94, 42, 0.54)",
    fill: "rgba(226, 132, 67, 0.14)"
  };
}

function getHallLabelInfo(tags) {
  const hallMappings = [
    { key: "hall:e", prefix: "東", color: "#b43a3a" },
    { key: "hall:w", prefix: "西", color: "#2a57ad" },
    { key: "hall:s", prefix: "南", color: "#2f8a4d" }
  ];
  for (const mapping of hallMappings) {
    const value = getTagValues(tags, mapping.key).find((item) => String(item || "").trim().length > 0);
    if (value !== undefined) {
      return {
        label: `${mapping.prefix}${String(value).trim()}`,
        color: mapping.color
      };
    }
  }
  return null;
}

function getWayCenter(way) {
  const minX = Math.min(...way.points.map((point) => point.x));
  const maxX = Math.max(...way.points.map((point) => point.x));
  const minY = Math.min(...way.points.map((point) => point.y));
  const maxY = Math.max(...way.points.map((point) => point.y));
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2
  };
}

function getMapStyle(way, selectedPathHighlightIds) {
  const tags = mergeTags(way.relationTags || {}, way.tags || {});
  const level = getDisplayLevel(tags);
  const pathHighlightStyle = getPathHighlightStyle(tags, selectedPathHighlightIds);
  const isBuilding = hasTag(tags, "building") || hasTag(tags, "building:part");
  const isIndoor = hasTag(tags, "indoor");
  const hallLabelInfo = getHallLabelInfo(tags);
  const hasHallLabel = Boolean(hallLabelInfo) && (isBuilding || isIndoor);

  if (pathHighlightStyle) {
    const closed = isClosedWay(way);
    return applyAreaScopeStyle({
      tags,
      level,
      layer: hasTag(tags, "highway") ? HIGHWAY_TOP_LAYER + 10 : 12,
      stroke: closed ? null : pathHighlightStyle.color,
      strokeWidth: 2.3,
      fill: closed ? pathHighlightStyle.fillColor : null,
      lineDash: closed ? [] : pathHighlightStyle.lineDash,
      arrowColor: pathHighlightStyle.color,
      hallLabel: hasHallLabel ? hallLabelInfo.label : null,
      hallLabelColor: hasHallLabel ? hallLabelInfo.color : null
    });
  }

  if (hasTagValue(tags, "highway", "pedestrian")) {
    const isElevated = hasTag(tags, "bridge") || level > 1;
    return applyAreaScopeStyle({
      tags,
      level,
      layer: HIGHWAY_TOP_LAYER + (isElevated ? 1 : 0),
      stroke: isElevated ? "rgba(52, 158, 166, 0.46)" : null,
      strokeWidth: isElevated ? 1.25 : 0,
      fill: "rgba(122, 225, 218, 0.34)",
      lineDash: []
    });
  }

  if (hasTagValue(tags, "highway", "tertiary")) {
    return applyAreaScopeStyle({
      tags,
      level,
      layer: HIGHWAY_TOP_LAYER,
      stroke: "#b4b8bd",
      strokeWidth: 10,
      fill: null,
      lineDash: []
    });
  }

  if (hasTagValue(tags, "highway", "footway")) {
    const stroke = hasPathTagKey(tags) ? "#00b86b" : "rgba(91, 124, 107, 0.72)";
    return applyAreaScopeStyle({
      tags,
      level,
      layer: HIGHWAY_TOP_LAYER + 2,
      stroke,
      strokeWidth: 0.9,
      fill: null,
      lineDash: []
    });
  }

  if (hasTagValue(tags, "highway", "steps")) {
    const stroke = hasPathTagKey(tags) ? "#00b86b" : "rgba(91, 124, 107, 0.72)";
    return applyAreaScopeStyle({
      tags,
      level,
      layer: HIGHWAY_TOP_LAYER + 2,
      stroke,
      strokeWidth: 1.05,
      fill: null,
      lineDash: [1.2, 2.4]
    });
  }

  if (hasTagValue(tags, "railway", "light_rail") || hasTagValue(tags, "railway", "rail")) {
    return applyAreaScopeStyle({
      tags,
      level,
      layer: 3,
      stroke: "rgba(42, 93, 158, 0.68)",
      strokeWidth: 2.4,
      fill: null,
      lineDash: []
    });
  }

  if (hasTagValue(tags, "railway", "station")) {
    return applyAreaScopeStyle({
      tags,
      level,
      layer: 1,
      stroke: "#aa8a4c",
      strokeWidth: 1.2,
      fill: "rgba(236, 215, 166, 0.74)",
      lineDash: []
    });
  }

  if (hasTagValue(tags, "railway", "platform")) {
    return applyAreaScopeStyle({
      tags,
      level,
      layer: 1,
      stroke: null,
      strokeWidth: 0,
      fill: "rgba(120, 128, 136, 0.28)",
      lineDash: []
    });
  }

  if (isBuilding) {
    const buildingColors = getBuildingColors(tags);
    return applyAreaScopeStyle({
      tags,
      level,
      layer: hasHallLabel ? HALL_TOP_LAYER : 0,
      stroke: buildingColors.stroke,
      strokeWidth: hasHallLabel ? 1.05 : 0.85,
      fill: buildingColors.fill,
      lineDash: [],
      hallLabel: hasHallLabel ? hallLabelInfo.label : null,
      hallLabelColor: hasHallLabel ? hallLabelInfo.color : null
    });
  }

  if (isIndoor) {
    const buildingColors = getBuildingColors(tags);
    return applyAreaScopeStyle({
      tags,
      level,
      layer: hasHallLabel ? HALL_TOP_LAYER : 0,
      stroke: buildingColors.stroke,
      strokeWidth: hasHallLabel ? 1.05 : 0.85,
      fill: null,
      lineDash: [],
      hallLabel: hasHallLabel ? hallLabelInfo.label : null,
      hallLabelColor: hasHallLabel ? hallLabelInfo.color : null
    });
  }

  if (hasTag(tags, "boundary")) {
    return applyAreaScopeStyle({
      tags,
      level,
      layer: 4,
      stroke: "rgba(177, 128, 219, 0.58)",
      strokeWidth: 4,
      fill: null,
      lineDash: []
    });
  }

  return {
    tags,
    level,
    layer: hasTag(tags, "tokyo-big-sight") && isClosedWay(way) ? -5 : -20,
    stroke: "rgba(117, 121, 126, 0.5)",
    strokeWidth: 0.75,
    fill: hasTag(tags, "tokyo-big-sight") && isClosedWay(way) ? "rgba(224, 104, 170, 0.24)" : null,
    lineDash: []
  };
}

function parseOsmWays(osmText) {
  const document = new DOMParser().parseFromString(osmText, "application/xml");
  const parserError = document.querySelector("parsererror");
  if (parserError) {
    throw new Error("Invalid OSM XML");
  }

  const rawNodes = [...document.querySelectorAll("node[id][lat][lon]")].map((node) => ({
    id: node.getAttribute("id"),
    lat: Number(node.getAttribute("lat")),
    lon: Number(node.getAttribute("lon")),
    tags: Object.fromEntries([...node.querySelectorAll("tag[k][v]")].map((tag) => [tag.getAttribute("k"), tag.getAttribute("v")]))
  })).filter((node) => node.id && Number.isFinite(node.lat) && Number.isFinite(node.lon));

  if (!rawNodes.length) {
    return { ways: [], bounds: null };
  }

  const centerLat = rawNodes.reduce((sum, node) => sum + node.lat, 0) / rawNodes.length;
  const centerLon = rawNodes.reduce((sum, node) => sum + node.lon, 0) / rawNodes.length;
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = Math.max(0.0001, Math.cos(centerLat * Math.PI / 180)) * metersPerDegreeLat;
  const projectedNodes = rawNodes.map((node) => ({
    ...node,
    x: (node.lon - centerLon) * metersPerDegreeLon,
    y: -(node.lat - centerLat) * metersPerDegreeLat
  }));
  const nodes = new Map(projectedNodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  const stationMarkers = projectedNodes.map(createRailwayStationMarker).filter(Boolean);

  const relationTagsByWayId = new Map();
  [...document.querySelectorAll("relation")].forEach((relation) => {
    const relationTags = Object.fromEntries([...relation.querySelectorAll("tag[k][v]")].map((tag) => [tag.getAttribute("k"), tag.getAttribute("v")]));
    if (!Object.keys(relationTags).length) {
      return;
    }
    [...relation.querySelectorAll("member[type='way'][ref]")].forEach((member) => {
      const wayId = member.getAttribute("ref");
      const tags = relationTagsByWayId.get(wayId) || {};
      Object.entries(relationTags).forEach(([key, value]) => addTagValue(tags, key, value));
      relationTagsByWayId.set(wayId, tags);
    });
  });

  const ways = [...document.querySelectorAll("way")].map((way, index) => {
    const id = way.getAttribute("id") || `way-${index}`;
    const nodeRefs = [...way.querySelectorAll("nd[ref]")].map((nodeRef) => nodeRef.getAttribute("ref")).filter(Boolean);
    const points = nodeRefs.map((nodeRef) => nodes.get(nodeRef)).filter(Boolean);
    const tags = Object.fromEntries([...way.querySelectorAll("tag[k][v]")].map((tag) => [tag.getAttribute("k"), tag.getAttribute("v")]));
    return { id, points, nodeRefs, tags, relationTags: relationTagsByWayId.get(id) || {} };
  }).filter((way) => way.points.length >= 2);

  const allPoints = ways.flatMap((way) => way.points);
  if (!allPoints.length) {
    return { ways: [], bounds: null };
  }

  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));

  return {
    ways,
    stationMarkers,
    bounds: {
      x: minX,
      y: minY,
      w: Math.max(1, maxX - minX),
      h: Math.max(1, maxY - minY)
    }
  };
}

function getFitViewState(bounds, width, height) {
  if (!bounds || width <= 1 || height <= 1) {
    return null;
  }
  const padding = Math.min(96, Math.max(32, Math.min(width, height) * 0.08));
  const zoom = clamp(Math.min((width - padding * 2) / bounds.w, (height - padding * 2) / bounds.h), 0.03, 60);
  return {
    zoom,
    offsetX: width / 2 - (bounds.x + bounds.w / 2) * zoom,
    offsetY: height / 2 - (bounds.y + bounds.h / 2) * zoom
  };
}

function getPointBounds(points) {
  if (!Array.isArray(points) || !points.length) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  });
  return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
}

function rectsOverlap(left, right, padding = 0) {
  return left.x <= right.x + right.w + padding
    && left.x + left.w >= right.x - padding
    && left.y <= right.y + right.h + padding
    && left.y + left.h >= right.y - padding;
}

function drawOnewayArrows(context, way, direction, color, tags) {
  if (!direction) {
    return;
  }
  const arrowInterval = 30;
  const isRail = hasTagValue(tags, "railway", "rail") || hasTagValue(tags, "railway", "light_rail");
  const arrowSize = isRail ? 3.4 : 5.1;
  const sourcePoints = direction === -1 ? [...way.points].reverse() : way.points;

  sourcePoints.slice(0, -1).forEach((start, index) => {
    const end = sourcePoints[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < arrowInterval * 0.6) {
      return;
    }
    const ux = dx / length;
    const uy = dy / length;
    const normalX = -uy;
    const normalY = ux;
    for (let distance = arrowInterval * 0.5; distance < length; distance += arrowInterval) {
      const tipX = start.x + ux * distance;
      const tipY = start.y + uy * distance;
      const baseX = tipX - ux * arrowSize;
      const baseY = tipY - uy * arrowSize;
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(tipX, tipY);
      context.lineTo(baseX + normalX * arrowSize * 0.45, baseY + normalY * arrowSize * 0.45);
      context.lineTo(baseX - normalX * arrowSize * 0.45, baseY - normalY * arrowSize * 0.45);
      context.closePath();
      context.fill();
    }
  });
}

function drawEditorOverlayEntities(context, page, graph, overlay, {
  selectedEntityId,
  showLabels,
  userMode,
  mapRotationDeg,
  islandLabelSetting,
  circleBoothColorByFullKey,
  circleBoothLabelByFullKey,
  circleBoothAbKeySet,
  boothLabelOffsets,
  viewZoom,
  projectToScreen,
  labelRenderCollector,
  selectedLabelColorIndexSet
}) {
  if (!page || !graph) {
    return;
  }

  const getBoothOverlayColor = (boothEntity) => {
    if (!boothEntity?.boothNumber) {
      return null;
    }
    const fullKey = getBoothFullKey(boothEntity);
    if (!fullKey) {
      return null;
    }
    const info = circleBoothLabelByFullKey?.get(fullKey);
    const colorIndex = Number(info?.colorIndex);
    if (!selectedLabelColorIndexSet?.has(colorIndex)) {
      return null;
    }
    const color = circleBoothColorByFullKey?.get(fullKey) || null;
    return color ? withAlpha(color, 0.48) : null;
  };

  const getBoothFullKey = (boothEntity) => {
    if (!boothEntity?.boothNumber) {
      return "";
    }
    const islandCode = findBoothIslandCodeFromGraph(graph, boothEntity);
    const boothNumberText = String(boothEntity.boothNumber || "").trim();
    const suffix = normalizeBoothSuffix(boothEntity.boothSuffix);
    if (!islandCode || !boothNumberText) {
      return "";
    }
    return `${islandCode}|${boothNumberText}|${suffix}`;
  };

  const getBoothLabelInfo = (boothEntity) => {
    const fullKey = getBoothFullKey(boothEntity);
    if (!fullKey) {
      return null;
    }
    const info = circleBoothLabelByFullKey?.get(fullKey);
    if (!info) {
      return null;
    }
    const colorIndex = Number(info.colorIndex);
    if (!selectedLabelColorIndexSet?.has(colorIndex)) {
      return null;
    }
    return {
      circleName: String(info.circleName || "").trim() || "-",
      authorName: String(info.authorName || "-").trim() || "-"
    };
  };

  const queueBoothColorLabel = (boothEntity, rect) => {
    const info = getBoothLabelInfo(boothEntity);
    if (!info || !rect) {
      return;
    }
    const circleName = String(info.circleName || "-").trim() || "-";
    const text = `${circleName}(${info.authorName})`;
    const fullKey = getBoothFullKey(boothEntity);
    if (!fullKey) {
      return;
    }
    const labelKey = `${page.page}|${fullKey}`;
    labelCandidates.push({
      id: boothEntity.id,
      key: labelKey,
      pageNumber: page.page,
      text,
      center: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 },
      boothRect: rect,
      size: Math.max(1.2, Math.min(2.6, Math.min(rect.w, rect.h) * 0.32))
    });
  };

  const getBoothPairKey = (boothEntity) => {
    const islandCode = findBoothIslandCodeFromGraph(graph, boothEntity);
    const boothNumberText = String(boothEntity?.boothNumber || "").trim();
    if (!islandCode || !boothNumberText) {
      return "";
    }
    return `${islandCode}|${boothNumberText}`;
  };

  const labelCandidates = [];
  const boothCollisionRects = [];

  const drawEntityShape = (entity, polygon, rect, labelOverride = null, selectedOverride = null, overlayFillColor = null) => {
    const style = EDITOR_ENTITY_STYLE[entity.type];
    if (!style || !polygon || polygon.length < 3) {
      return;
    }
    const selected = selectedOverride ?? (entity.id === selectedEntityId);
    context.beginPath();
    drawPolygon(context, polygon);
    context.closePath();
    context.fillStyle = style.fill;
    context.fill();
    if (overlayFillColor) {
      context.fillStyle = overlayFillColor;
      context.fill();
    }
    const shouldStroke = (selected || (entity.type !== "group" && entity.type !== "island"))
      && !(userMode && entity.type === "hall");
    if (shouldStroke) {
      context.strokeStyle = selected ? "#cb4b16" : style.stroke;
      context.lineWidth = selected ? Math.max(0.65, 3.2 * Math.max(overlay.scale, 0.0001)) : Math.max(0.2, (entity.type === "booth" ? 0.45 : 1.8) * Math.max(overlay.scale, 0.0001));
      context.stroke();
    }

    if (!showLabels) {
      return;
    }
    if (entity.type === "booth") {
      const defaultLabel = String(entity.boothNumber || "").trim();
      const label = labelOverride ?? defaultLabel;
      const minLabelBoxSize = 0.9;
      if (!label || rect.w < minLabelBoxSize || rect.h < minLabelBoxSize) {
        return;
      }
      const fontSize = Math.max(1.3, Math.min(rect.w, rect.h) * 0.22);
      drawScreenAlignedText(context, label, rect.x + rect.w / 2, rect.y + rect.h / 2, fontSize, "#2f3338", mapRotationDeg);
    }
    if (entity.type === "island" && entity.raw) {
      const polygon = graph.getWorldPolygon(entity.id).map((point) => transformEditorOverlayPoint(point, overlay));
      if (polygon.length < 3) {
        return;
      }
      const baseAnchor = getPolygonSideAnchor(polygon, islandLabelSetting?.side, 0);
      const screenOffset = screenOffsetToCanvasUnits(islandLabelSetting?.offsetX, islandLabelSetting?.offsetY, mapRotationDeg);
      const anchor = {
        x: baseAnchor.x + screenOffset.x,
        y: baseAnchor.y + screenOffset.y
      };
      drawScreenAlignedText(context, entity.raw, anchor.x, anchor.y, 3, "#5e3f9c", mapRotationDeg);
    }
  };

  const drawEntity = (entity, pad = 0) => {
    const polygon = graph.getWorldPolygon(entity.id, pad).map((point) => transformEditorOverlayPoint(point, overlay));
    if (polygon.length < 3) {
      return;
    }
    const rect = rectFromPoints(polygon);
    const boothOverlayColor = entity.type === "booth" ? getBoothOverlayColor(entity) : null;
    drawEntityShape(entity, polygon, rect, null, null, boothOverlayColor);
    if (entity.type === "booth") {
      boothCollisionRects.push(rect);
      queueBoothColorLabel(entity, rect);
    }
  };

  if (!userMode) {
    (page.entities.halls || []).forEach((entity) => drawEntity(entity, 12));
  }
  (page.entities.islands || []).forEach((entity) => drawEntity(entity, 8));
  (page.entities.groups || []).forEach((entity) => drawEntity(entity, 4));
  const booths = page.entities.booths || [];
  const pairedBoothIds = new Set();
  const boothPairByKey = new Map();
  booths.forEach((booth) => {
    const suffix = normalizeBoothPairSuffix(booth.boothSuffix);
    if (!suffix || !booth.boothNumber) {
      return;
    }
    const key = `${booth.parentId || "root"}::${booth.boothNumber}`;
    const pair = boothPairByKey.get(key) || { a: null, b: null };
    pair[suffix] = booth;
    boothPairByKey.set(key, pair);
  });

  boothPairByKey.forEach((pair) => {
    if (!pair.a || !pair.b) {
      return;
    }
    const polygonA = graph.getWorldPolygon(pair.a.id, 0).map((point) => transformEditorOverlayPoint(point, overlay));
    const polygonB = graph.getWorldPolygon(pair.b.id, 0).map((point) => transformEditorOverlayPoint(point, overlay));
    const mergedPolygon = tryBuildMergedBoothPolygon(polygonA, polygonB);
    if (!mergedPolygon) {
      const rectA = rectFromPoints(polygonA);
      const rectB = rectFromPoints(polygonB);
      boothCollisionRects.push(rectA, rectB);
      queueBoothColorLabel(pair.a, rectA);
      queueBoothColorLabel(pair.b, rectB);
      return;
    }
    const overlayColorA = getBoothOverlayColor(pair.a);
    const overlayColorB = getBoothOverlayColor(pair.b);
    pairedBoothIds.add(pair.a.id);
    pairedBoothIds.add(pair.b.id);
    const mergedRect = rectFromPoints(mergedPolygon);
    const rectA = rectFromPoints(polygonA);
    const rectB = rectFromPoints(polygonB);
    const pairBoothKey = getBoothPairKey(pair.a);
    const useMergedAbOverlay = Boolean(pairBoothKey) && Boolean(circleBoothAbKeySet?.has(pairBoothKey));
    const mergedLabel = String(pair.a.boothNumber || "").trim();
    const selected = pair.a.id === selectedEntityId || pair.b.id === selectedEntityId;
    // Always draw one shared booth frame/label for an ab pair.
    drawEntityShape(pair.a, mergedPolygon, mergedRect, mergedLabel, selected);

    if (useMergedAbOverlay) {
      boothCollisionRects.push(mergedRect);
      const pairLabelInfo = getBoothLabelInfo(pair.a);
      if (pairLabelInfo) {
        labelCandidates.push({
          id: pair.a.id,
          key: `${page.page}|${pairBoothKey}|ab`,
          pageNumber: page.page,
          text: `${pairLabelInfo.circleName}(${pairLabelInfo.authorName})`,
          center: { x: mergedRect.x + mergedRect.w / 2, y: mergedRect.y + mergedRect.h / 2 },
          boothRect: mergedRect,
          size: Math.max(1.2, Math.min(2.6, Math.min(mergedRect.w, mergedRect.h) * 0.32))
        });
      }
      const mergedOverlayColor = overlayColorA || overlayColorB;
      if (mergedOverlayColor) {
        context.beginPath();
        drawPolygon(context, mergedPolygon);
        context.closePath();
        context.fillStyle = mergedOverlayColor;
        context.fill();
      }
      return;
    }

    boothCollisionRects.push(rectA, rectB);
    queueBoothColorLabel(pair.a, rectA);
    queueBoothColorLabel(pair.b, rectB);

    // Draw translucent color overlays independently on each half with no stroke.
    if (overlayColorA) {
      context.beginPath();
      drawPolygon(context, polygonA);
      context.closePath();
      context.fillStyle = overlayColorA;
      context.fill();
    }
    if (overlayColorB) {
      context.beginPath();
      drawPolygon(context, polygonB);
      context.closePath();
      context.fillStyle = overlayColorB;
      context.fill();
    }
  });

  booths.forEach((entity) => {
    if (pairedBoothIds.has(entity.id)) {
      return;
    }
    drawEntity(entity, 0);
  });

  const rectsOverlap = (left, right) => (
    left.x < right.x + right.w
      && left.x + left.w > right.x
      && left.y < right.y + right.h
      && left.y + left.h > right.y
  );

  const drawBoothSideLabels = () => {
    if (!labelCandidates.length) {
      return;
    }
    const placedRects = [];
    labelCandidates.forEach((candidate) => {
      const neighbors = labelCandidates.filter((item) => item.id !== candidate.id);
      let vx = 1;
      let vy = -0.4;
      neighbors.forEach((neighbor) => {
        const dx = candidate.center.x - neighbor.center.x;
        const dy = candidate.center.y - neighbor.center.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 0.001 || distance > 24) {
          return;
        }
        vx += dx / distance;
        vy += dy / distance;
      });

      const vectorLength = Math.max(0.0001, Math.hypot(vx, vy));
      const nx = vx / vectorLength;
      const ny = vy / vectorLength;
      const directions = [
        { x: nx, y: ny },
        { x: -ny, y: nx },
        { x: ny, y: -nx },
        { x: -nx, y: -ny }
      ];

      const textWidth = Math.max(5, candidate.text.length * candidate.size * 0.55);
      const textHeight = Math.max(1.6, candidate.size * 1.15);
      const baseOffset = Math.max(2.2, Math.max(candidate.boothRect.w, candidate.boothRect.h) * 0.6);

      let pickedAnchor = {
        x: candidate.center.x + directions[0].x * (baseOffset + textWidth * 0.5),
        y: candidate.center.y + directions[0].y * (baseOffset + textHeight * 0.5)
      };
      let pickedRect = {
        x: pickedAnchor.x - textWidth / 2,
        y: pickedAnchor.y - textHeight / 2,
        w: textWidth,
        h: textHeight
      };

      const manualOffset = boothLabelOffsets?.[candidate.key];
      if (manualOffset) {
        pickedAnchor = {
          x: candidate.center.x + asFiniteNumber(manualOffset.dx, 0),
          y: candidate.center.y + asFiniteNumber(manualOffset.dy, 0)
        };
        pickedRect = {
          x: pickedAnchor.x - textWidth / 2,
          y: pickedAnchor.y - textHeight / 2,
          w: textWidth,
          h: textHeight
        };
      }

      const multipliers = [1, 1.3, 1.7, 2.1];
      let found = false;
      if (!manualOffset) {
        for (const direction of directions) {
          for (const multiplier of multipliers) {
            const offset = baseOffset * multiplier;
            const anchor = {
              x: candidate.center.x + direction.x * (offset + textWidth * 0.5),
              y: candidate.center.y + direction.y * (offset + textHeight * 0.5)
            };
            const rect = {
              x: anchor.x - textWidth / 2,
              y: anchor.y - textHeight / 2,
              w: textWidth,
              h: textHeight
            };
            const overlapsPlaced = placedRects.some((placed) => rectsOverlap(rect, placed));
            const overlapsBooth = boothCollisionRects.some((boothRect) => rectsOverlap(rect, boothRect));
            if (overlapsPlaced || overlapsBooth) {
              continue;
            }
            pickedAnchor = anchor;
            pickedRect = rect;
            found = true;
            break;
          }
          if (found) {
            break;
          }
        }
      }

      context.save();
      context.strokeStyle = "rgba(72, 80, 88, 0.42)";
      context.lineWidth = Math.max(0.18, 0.42 * Math.max(overlay.scale, 0.0001));
      context.beginPath();
      context.moveTo(candidate.center.x, candidate.center.y);
      context.lineTo(pickedAnchor.x, pickedAnchor.y);
      context.stroke();
      context.restore();

      drawScreenAlignedText(context, candidate.text, pickedAnchor.x, pickedAnchor.y, candidate.size, "#1f2933", mapRotationDeg);
      placedRects.push(pickedRect);

      if (projectToScreen && labelRenderCollector) {
        const screenAnchor = projectToScreen(pickedAnchor);
        const fontSizePx = candidate.size * Math.max(0.0001, asFiniteNumber(viewZoom, 1));
        const textWidthPx = Math.max(8, candidate.text.length * fontSizePx * 0.55);
        const textHeightPx = Math.max(8, fontSizePx * 1.2);
        labelRenderCollector.push({
          key: candidate.key,
          pageNumber: candidate.pageNumber,
          text: candidate.text,
          anchorWorld: pickedAnchor,
          boothCenterWorld: candidate.center,
          screenRect: {
            x: screenAnchor.x - textWidthPx / 2,
            y: screenAnchor.y - textHeightPx / 2,
            w: textWidthPx,
            h: textHeightPx
          }
        });
      }
    });
  };

  drawBoothSideLabels();
}

export function OsmMapPage({ isUserMode = true, enableEditTools = true }) {
  const canvasRef = useRef(null);
  const frameRef = useRef(0);
  const viewUpdateFrameRef = useRef(0);
  const pendingViewUpdateRef = useRef(null);
  const viewStateRef = useRef({ zoom: 1, offsetX: 0, offsetY: 0 });
  const hoverHitFrameRef = useRef(0);
  const pendingHoverCanvasPointRef = useRef(null);
  const boothLabelOffsetFrameRef = useRef(0);
  const pendingBoothLabelOffsetsRef = useRef({});
  const dragStateRef = useRef({ type: "none", pointerId: null, lastX: 0, lastY: 0 });
  const touchPointersRef = useRef(new Map());
  const pinchStateRef = useRef({ active: false, lastDistance: 0 });
  const renderedBoothLabelsRef = useRef([]);
  const editorBoothLabelOffsetsRef = useRef({});
  const uiPreferencesHydratedRef = useRef(false);
  const uiPreferencesSaveTimerRef = useRef(null);
  const hasCenteredOriginRef = useRef(false);

  const [ways, setWays] = useState([]);
  const [stationMarkers, setStationMarkers] = useState([]);
  const [selectedCircleDay, setSelectedCircleDay] = useState("day1");
  const [circleRows, setCircleRows] = useState([]);
  const [selectedLabelColorIndexes, setSelectedLabelColorIndexes] = useState(() => readLocalFilterPreferences().selectedLabelColorIndexes);
  const [selectedBoothCircle, setSelectedBoothCircle] = useState(null);
  const [isHoverClickableBooth, setIsHoverClickableBooth] = useState(false);
  const [isHallLabelPanelOpen, setIsHallLabelPanelOpen] = useState(true);
  const [isColorFilterPanelOpen, setIsColorFilterPanelOpen] = useState(false);
  const [isLevelPanelOpen, setIsLevelPanelOpen] = useState(false);
  const [hiddenHallLabels, setHiddenHallLabels] = useState([]);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [selectedLevels, setSelectedLevels] = useState([...USER_MODE_DEFAULT_LEVELS]);
  const [selectedPathHighlightIds, setSelectedPathHighlightIds] = useState([]);
  const [editorPages, setEditorPages] = useState([]);
  const [loadedEditorPageNumbers, setLoadedEditorPageNumbers] = useState([]);
  const [selectedEditorPageNumber, setSelectedEditorPageNumber] = useState(1);
  const [showEditorOverlay, setShowEditorOverlay] = useState(false);
  const [showEditorLabels, setShowEditorLabels] = useState(false);
  const [isEditorOverlayMoveMode, setIsEditorOverlayMoveMode] = useState(true);
  const [editorOverlay, setEditorOverlay] = useState(EDITOR_OVERLAY_DEFAULT);
  const [editorPageOverlays, setEditorPageOverlays] = useState({});
  const [editorPageIslandLabelSettings, setEditorPageIslandLabelSettings] = useState({});
  const [editorBoothLabelOffsets, setEditorBoothLabelOffsets] = useState({});
  const [selectedEditorEntityId, setSelectedEditorEntityId] = useState("");
  const [mapRotationDeg, setMapRotationDeg] = useState(34);
  const [useGyroRotation, setUseGyroRotation] = useState(false);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const [viewState, setViewState] = useState({ zoom: 1, offsetX: 0, offsetY: 0 });
  const stepConnectorVisibleWayIds = useMemo(() => getStepConnectorVisibleWayIds(ways, selectedLevels), [ways, selectedLevels]);
  const selectedEditorPage = useMemo(
    () => editorPages.find((page) => page.page === Number(selectedEditorPageNumber)) || editorPages[0] || null,
    [editorPages, selectedEditorPageNumber]
  );
  const loadedEditorPages = useMemo(
    () => editorPages.filter((page) => loadedEditorPageNumbers.includes(page.page)),
    [editorPages, loadedEditorPageNumbers]
  );
  const editorGraphByPage = useMemo(
    () => new Map(loadedEditorPages.map((page) => [page.page, buildEditorEntityGraph(page)])),
    [loadedEditorPages]
  );
  const allEditorPageNumbers = useMemo(() => editorPages.map((page) => page.page), [editorPages]);
  const effectiveShowEditorLabels = isUserMode || showEditorLabels;
  const hallLabelOptions = useMemo(() => {
    const byLabel = new Map();
    ways.forEach((way) => {
      const style = getMapStyle(way, selectedPathHighlightIds);
      if (!style.hallLabel || byLabel.has(style.hallLabel)) {
        return;
      }
      byLabel.set(style.hallLabel, style.hallLabelColor || "#404246");
    });
    return [...byLabel.entries()]
      .map(([label, color]) => ({ label, color }))
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
  }, [selectedPathHighlightIds, ways]);
  const styledWays = useMemo(
    () => ways.map((way, index) => ({ way, index, style: getMapStyle(way, selectedPathHighlightIds) }))
      .filter((item) => item.style)
      .map((item) => {
        const forceLevelVisible = stepConnectorVisibleWayIds.has(item.way.id);
        return {
          ...item,
          bounds: getPointBounds(item.way.points),
          forceLevelVisible,
          style: applyLevelFocusStyle(item.style, selectedLevels, forceLevelVisible)
        };
      })
      .sort((left, right) => {
        const leftFocused = left.forceLevelVisible || isLevelFocused(left.style.level, selectedLevels) ? 1 : 0;
        const rightFocused = right.forceLevelVisible || isLevelFocused(right.style.level, selectedLevels) ? 1 : 0;
        return leftFocused - rightFocused || left.style.level - right.style.level || left.style.layer - right.style.layer || left.index - right.index;
      }),
    [selectedLevels, selectedPathHighlightIds, stepConnectorVisibleWayIds, ways]
  );
  const stationMarkerRenderData = useMemo(
    () => stationMarkers.map((marker) => ({
      ...marker,
      screenPoint: toScreenPoint(marker, {
        ...viewState,
        rotationDeg: mapRotationDeg,
        viewportWidth: canvasRef.current?.clientWidth || 0,
        viewportHeight: canvasRef.current?.clientHeight || 0
      })
    })),
    [mapRotationDeg, stationMarkers, viewState]
  );
  const editorEntityOptions = useMemo(() => selectedEditorPage ? flattenEditorEntities(selectedEditorPage.entities) : [], [selectedEditorPage]);
  const selectedEditorEntity = useMemo(
    () => editorEntityOptions.find((entity) => entity.id === selectedEditorEntityId) || null,
    [editorEntityOptions, selectedEditorEntityId]
  );
  const circleBoothColorMaps = useMemo(
    () => buildCircleBoothColorMaps(circleRows, selectedCircleDay),
    [circleRows, selectedCircleDay]
  );
  const selectedLabelColorIndexSet = useMemo(
    () => new Set(selectedLabelColorIndexes),
    [selectedLabelColorIndexes]
  );
  const hiddenHallLabelSet = useMemo(
    () => new Set(hiddenHallLabels),
    [hiddenHallLabels]
  );
  const circleRowsByBoothKey = useMemo(() => {
    const byKey = new Map();
    const put = (key, row) => {
      const list = byKey.get(key) || [];
      list.push(row);
      byKey.set(key, list);
    };

    circleRows.forEach((row) => {
      const location = String(row?.booth_location || "").trim();
      if (!location || getDayCategory(location) !== selectedCircleDay) {
        return;
      }
      const parsed = parseLocation(location);
      if (!parsed?.isValid) {
        return;
      }
      const island = normalizeIslandCode(parsed.islandCode);
      const boothNumber = String(parsed.boothNumber || "").trim();
      if (!island || !boothNumber) {
        return;
      }
      const suffixText = String(parsed.suffixText || "").toLowerCase();
      const suffixes = suffixText === "ab" ? ["a", "b"] : suffixText ? [suffixText] : ["", "a", "b"];
      suffixes.forEach((suffix) => {
        put(`${island}|${boothNumber}|${normalizeBoothSuffix(suffix)}`, row);
      });
    });

    return byKey;
  }, [circleRows, selectedCircleDay]);
  const selectedEditorPageIslandLabelSetting = useMemo(
    () => normalizeIslandLabelSetting(editorPageIslandLabelSettings[String(selectedEditorPage?.page || selectedEditorPageNumber)]),
    [editorPageIslandLabelSettings, selectedEditorPage, selectedEditorPageNumber]
  );
  const selectedEditorPageGraph = useMemo(
    () => selectedEditorPage ? editorGraphByPage.get(selectedEditorPage.page) || buildEditorEntityGraph(selectedEditorPage) : null,
    [editorGraphByPage, selectedEditorPage]
  );
  const gyroSupported = typeof window !== "undefined" && typeof window.DeviceOrientationEvent !== "undefined";

  useEffect(() => {
    viewStateRef.current = viewState;
  }, [viewState]);

  useEffect(() => {
    if (!useGyroRotation || !gyroSupported) {
      return;
    }

    const handleDeviceOrientation = (event) => {
      const headingDeg = extractNorthHeadingDegrees(event);
      if (!Number.isFinite(headingDeg)) {
        return;
      }

      const nextRotation = normalizeSignedDegrees(-headingDeg);
      setMapRotationDeg(roundCoordinate(nextRotation));
    };

    window.addEventListener("deviceorientation", handleDeviceOrientation, true);
    window.addEventListener("deviceorientationabsolute", handleDeviceOrientation, true);
    return () => {
      window.removeEventListener("deviceorientation", handleDeviceOrientation, true);
      window.removeEventListener("deviceorientationabsolute", handleDeviceOrientation, true);
    };
  }, [gyroSupported, useGyroRotation]);

  useEffect(() => {
    editorBoothLabelOffsetsRef.current = editorBoothLabelOffsets;
  }, [editorBoothLabelOffsets]);

  useEffect(() => {
    return () => {
      if (uiPreferencesSaveTimerRef.current) {
        clearTimeout(uiPreferencesSaveTimerRef.current);
        uiPreferencesSaveTimerRef.current = null;
      }
      if (viewUpdateFrameRef.current) {
        cancelAnimationFrame(viewUpdateFrameRef.current);
        viewUpdateFrameRef.current = 0;
      }
      if (hoverHitFrameRef.current) {
        cancelAnimationFrame(hoverHitFrameRef.current);
        hoverHitFrameRef.current = 0;
      }
      if (boothLabelOffsetFrameRef.current) {
        cancelAnimationFrame(boothLabelOffsetFrameRef.current);
        boothLabelOffsetFrameRef.current = 0;
      }
    };
  }, []);

  const canvasCursor = useMemo(() => {
    if (isPanning) {
      return "grabbing";
    }
    if (isHoverClickableBooth && isUserMode && !isSpacePressed) {
      return "pointer";
    }
    if (isEditorOverlayMoveMode && showEditorOverlay && selectedEditorPage) {
      return "move";
    }
    return isSpacePressed ? "grab" : "default";
  }, [isEditorOverlayMoveMode, isHoverClickableBooth, isPanning, isSpacePressed, isUserMode, selectedEditorPage, showEditorOverlay]);

  useEffect(() => {
    if (!isUserMode && selectedBoothCircle) {
      setSelectedBoothCircle(null);
    }
  }, [isUserMode, selectedBoothCircle]);

  useEffect(() => {
    if (!isUserMode) {
      setIsHoverClickableBooth(false);
      return;
    }
    // User mode should prioritize click interaction over editor overlay dragging.
    setIsEditorOverlayMoveMode(false);
  }, [isUserMode]);

  function getOverlayTransformForPage(pageNumber) {
    if (Number(pageNumber) === Number(selectedEditorPageNumber)) {
      return editorOverlay;
    }
    return normalizeEditorOverlayTransform(editorPageOverlays[String(pageNumber)]);
  }

  function findDraggableLabelAtCanvasPoint(canvasPoint) {
    const labels = renderedBoothLabelsRef.current || [];
    for (let index = labels.length - 1; index >= 0; index -= 1) {
      const label = labels[index];
      if (!label?.screenRect) {
        continue;
      }
      const rect = label.screenRect;
      if (canvasPoint.x >= rect.x
        && canvasPoint.x <= rect.x + rect.w
        && canvasPoint.y >= rect.y
        && canvasPoint.y <= rect.y + rect.h) {
        return label;
      }
    }
    return null;
  }

  function resolveBoothCircle(boothEntity, graph) {
    if (!boothEntity || !graph) {
      return null;
    }
    const islandCode = findBoothIslandCodeFromGraph(graph, boothEntity);
    const boothNumber = String(boothEntity.boothNumber || "").trim();
    const suffix = normalizeBoothSuffix(boothEntity.boothSuffix);
    if (!islandCode || !boothNumber) {
      return null;
    }

    const exactKey = `${islandCode}|${boothNumber}|${suffix}`;
    const fallbackKey = `${islandCode}|${boothNumber}|`;
    const exactMatches = circleRowsByBoothKey.get(exactKey) || [];
    const fallbackMatches = suffix ? (circleRowsByBoothKey.get(fallbackKey) || []) : [];
    return exactMatches[0] || fallbackMatches[0] || null;
  }

  function findOverlayHitInPage(worldPoint, page, graph) {
    if (!worldPoint || !page || !graph) {
      return null;
    }

    const overlay = getOverlayTransformForPage(page.page);
    const worldPolygonWithOverlay = (entityId) => (
      graph.getWorldPolygon(entityId).map((point) => transformEditorOverlayPoint(point, overlay))
    );
    const isDescendantOf = (entity, ancestorId) => {
      let cursor = entity;
      while (cursor?.parentId) {
        if (cursor.parentId === ancestorId) {
          return true;
        }
        cursor = graph.byId.get(cursor.parentId);
      }
      return false;
    };
    const chooseSmallestContaining = (entities) => {
      let best = null;
      entities.forEach((entity) => {
        const polygon = worldPolygonWithOverlay(entity.id);
        if (!isPointInPolygon(worldPoint, polygon)) {
          return;
        }
        const area = polygonArea(polygon);
        if (!best || area < best.area) {
          best = { entity, area };
        }
      });
      return best?.entity || null;
    };
    const chooseTypedHit = (type, entities) => {
      const entity = chooseSmallestContaining(entities || []);
      if (!entity) {
        return null;
      }
      const area = polygonArea(worldPolygonWithOverlay(entity.id));
      return { type, entity, pageNumber: page.page, graph, area };
    };

    const halls = page.entities.halls || [];
    const islands = page.entities.islands || [];
    const groups = page.entities.groups || [];
    const booths = page.entities.booths || [];

    const hitHall = chooseSmallestContaining(halls);
    if (!hitHall) {
      // Fallback when hierarchy links are incomplete.
      return chooseTypedHit("booth", booths)
        || chooseTypedHit("group", groups)
        || chooseTypedHit("island", islands)
        || null;
    }
    const islandCandidates = islands.filter((entity) => isDescendantOf(entity, hitHall.id));
    const hitIsland = chooseSmallestContaining(islandCandidates);
    if (!hitIsland) {
      return chooseTypedHit("hall", [hitHall]);
    }
    const groupCandidates = groups.filter((entity) => isDescendantOf(entity, hitIsland.id));
    const hitGroup = chooseSmallestContaining(groupCandidates);
    if (hitGroup) {
      const boothCandidates = booths.filter((entity) => isDescendantOf(entity, hitGroup.id));
      const hitBooth = chooseSmallestContaining(boothCandidates);
      if (hitBooth) {
        return chooseTypedHit("booth", [hitBooth]);
      }
      return chooseTypedHit("group", [hitGroup]);
    }

    // Some data has booth directly under island without a group.
    const islandBoothCandidates = booths.filter((entity) => isDescendantOf(entity, hitIsland.id));
    const hitBooth = chooseSmallestContaining(islandBoothCandidates);
    if (hitBooth) {
      return chooseTypedHit("booth", [hitBooth]);
    }

    // Final local fallback under current hall.
    return chooseTypedHit("group", groups.filter((entity) => isDescendantOf(entity, hitHall.id)))
      || chooseTypedHit("island", [hitIsland]);
  }

  function findOverlayHitAtWorldPoint(worldPoint) {
    if (!worldPoint || !showEditorOverlay) {
      return null;
    }
    const pagesToSearch = loadedEditorPages.length
      ? loadedEditorPages
      : (selectedEditorPage ? [selectedEditorPage] : []);
    let best = null;
    pagesToSearch.forEach((page) => {
      const graph = editorGraphByPage.get(page.page)
        || (selectedEditorPage && page.page === selectedEditorPage.page ? selectedEditorPageGraph : null)
        || buildEditorEntityGraph(page);
      const hit = findOverlayHitInPage(worldPoint, page, graph);
      if (!hit) {
        return;
      }
      if (!best || hit.area < best.area) {
        best = hit;
      }
    });
    return best;
  }

  function isClickableBoothHit(hitResult) {
    if (!hitResult || hitResult.type !== "booth") {
      return false;
    }
    return Boolean(resolveBoothCircle(hitResult.entity, hitResult.graph));
  }

  useEffect(() => {
    let isMounted = true;
    async function loadLockedOsm() {
      try {
        const response = await fetch(`${OSM_FILE_API}?path=${encodeURIComponent(LOCKED_OSM_FILE)}`);
        const json = await readJson(response);
        const parsed = parseOsmWays(String(json.data?.content || ""));
        if (!isMounted) {
          return;
        }
        setWays(parsed.ways);
        setStationMarkers(parsed.stationMarkers || []);

        const canvas = canvasRef.current;
        if (canvas && parsed.bounds) {
          const nextViewState = getFitViewState(parsed.bounds, canvas.clientWidth, canvas.clientHeight);
          if (nextViewState) {
            setViewState(nextViewState);
          }
        }
      } catch {
        if (isMounted) {
          setWays([]);
          setStationMarkers([]);
        }
      }
    }
    loadLockedOsm();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function loadCircleRows() {
      try {
        const rows = await fetchAllCirclesFromApi(FAVORITE_CIRCLES_API, 200);
        if (!isMounted) {
          return;
        }
        const normalized = rows.map(normalizeCircle);
        setCircleRows(normalized);
      } catch {
        if (!isMounted) {
          return;
        }
        setCircleRows([]);
      }
    }

    loadCircleRows();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!editorEntityOptions.length) {
      setSelectedEditorEntityId("");
      return;
    }
    if (!editorEntityOptions.some((entity) => entity.id === selectedEditorEntityId)) {
      setSelectedEditorEntityId(editorEntityOptions[0].id);
    }
  }, [editorEntityOptions, selectedEditorEntityId]);

  useEffect(() => {
    if (!editorPages.length) {
      return;
    }
    setEditorPageOverlays((current) => ({
      ...current,
      [String(selectedEditorPageNumber)]: normalizeEditorOverlayTransform(editorOverlay)
    }));
  }, [editorOverlay, editorPages.length, selectedEditorPageNumber]);

  useEffect(() => {
    if (!isUserMode || !editorPages.length) {
      return;
    }
    setShowEditorOverlay(true);
    setLoadedEditorPageNumbers(allEditorPageNumbers);
    setSelectedLevels([...USER_MODE_DEFAULT_LEVELS]);
  }, [allEditorPageNumbers, editorPages.length, isUserMode]);

  useEffect(() => {
    saveLocalFilterPreferences({ selectedLabelColorIndexes });
  }, [selectedLabelColorIndexes]);

  useEffect(() => {
    let isMounted = true;

    async function loadEditorPagesFromMap() {
      try {
        const pagesResponse = await fetch(MAP_PAGES_API);
        const pagesJson = await readJson(pagesResponse);
        const pageItems = Array.isArray(pagesJson.data) ? pagesJson.data : [];

        const pagePayloads = await Promise.all(
          pageItems.map(async (item) => {
            const pageNo = Number(item?.page || 0);
            if (!Number.isFinite(pageNo) || pageNo <= 0) {
              return null;
            }

            const response = await fetch(`${MAP_PAGES_API}/${pageNo}`);
            const json = await readJson(response);
            return json?.data || null;
          })
        );

        const savedTransforms = await readSavedEditorOverlayTransformsFromApi() || readSavedEditorOverlayTransforms();
        const localFilterPreferences = readLocalFilterPreferences();
        const pages = applySavedEditorTransforms(
          pagePayloads
            .filter(Boolean)
            .map(normalizeEditorPage)
            .sort((left, right) => left.page - right.page),
          savedTransforms
        );
        const nextPageOverlays = Object.fromEntries(pages.map((page) => [String(page.page), normalizeEditorOverlayTransform(savedTransforms.pageOverlays?.[String(page.page)])]));
        const nextPageIslandLabelSettings = Object.fromEntries(
          pages.map((page) => [String(page.page), normalizeIslandLabelSetting(savedTransforms.pageIslandLabelSettings?.[String(page.page)])])
        );
        const nextBoothLabelOffsets = normalizeBoothLabelOffsets(savedTransforms.boothLabelOffsets);
        const savedUiPreferences = normalizeUiPreferences(savedTransforms.uiPreferences);
        if (!isMounted) {
          return;
        }
        setEditorPages(pages);
        setEditorPageOverlays(nextPageOverlays);
        setEditorPageIslandLabelSettings(nextPageIslandLabelSettings);
        setEditorBoothLabelOffsets(nextBoothLabelOffsets);
        setSelectedCircleDay(savedUiPreferences.selectedCircleDay);
        setSelectedLabelColorIndexes(localFilterPreferences.selectedLabelColorIndexes);
        setSelectedPathHighlightIds(savedUiPreferences.selectedPathHighlightIds);
        setSelectedLevels([...USER_MODE_DEFAULT_LEVELS]);
        setHiddenHallLabels(savedUiPreferences.hiddenHallLabels);
        const firstPageNumber = pages[0]?.page || 1;
        setLoadedEditorPageNumbers(pages.map((page) => page.page));
        setSelectedEditorPageNumber(firstPageNumber);
        setEditorOverlay(nextPageOverlays[String(firstPageNumber)] || EDITOR_OVERLAY_DEFAULT);
        setShowEditorOverlay(Boolean(pages.length));
        uiPreferencesHydratedRef.current = true;
      } catch {
        if (!isMounted) {
          return;
        }
        setEditorPages([]);
        setLoadedEditorPageNumbers([]);
        setEditorPageOverlays({});
        setEditorPageIslandLabelSettings({});
        setEditorBoothLabelOffsets({});
        setSelectedLabelColorIndexes(readLocalFilterPreferences().selectedLabelColorIndexes);
        setSelectedLevels([...USER_MODE_DEFAULT_LEVELS]);
        setHiddenHallLabels([]);
        uiPreferencesHydratedRef.current = true;
        setShowEditorOverlay(false);
      }
    }
    loadEditorPagesFromMap();
    return () => {
      isMounted = false;
    };
  }, [enableEditTools]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.code !== "Space") {
        return;
      }
      event.preventDefault();
      if (!event.repeat) {
        setIsSpacePressed(true);
        const activeElement = document.activeElement;
        if (activeElement && typeof activeElement.blur === "function") {
          activeElement.blur();
        }
      }
    }

    function handleKeyUp(event) {
      if (event.code !== "Space") {
        return;
      }
      event.preventDefault();
      setIsSpacePressed(false);
      dragStateRef.current = { type: "none", pointerId: null, lastX: 0, lastY: 0 };
      setIsPanning(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    function resizeCanvasToDisplaySize() {
      const devicePixelRatio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(canvas.clientWidth * devicePixelRatio));
      const height = Math.max(1, Math.floor(canvas.clientHeight * devicePixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      if (!hasCenteredOriginRef.current && canvas.clientWidth > 1 && canvas.clientHeight > 1) {
        hasCenteredOriginRef.current = true;
        setViewState((current) => ({
          ...current,
          offsetX: canvas.clientWidth / 2,
          offsetY: canvas.clientHeight / 2
        }));
      }
    }

    function draw() {
      resizeCanvasToDisplaySize();
      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }

      const devicePixelRatio = window.devicePixelRatio || 1;
      const width = canvas.width / devicePixelRatio;
      const height = canvas.height / devicePixelRatio;
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);

      context.fillStyle = "#f6f4ef";
      context.fillRect(0, 0, width, height);

      const drawViewState = {
        ...viewState,
        rotationDeg: mapRotationDeg,
        viewportWidth: width,
        viewportHeight: height
      };
      const corners = [
        toWorldPoint({ x: 0, y: 0 }, drawViewState),
        toWorldPoint({ x: width, y: 0 }, drawViewState),
        toWorldPoint({ x: 0, y: height }, drawViewState),
        toWorldPoint({ x: width, y: height }, drawViewState)
      ];
      const rightWorld = Math.max(...corners.map((point) => point.x));
      const topWorld = Math.min(...corners.map((point) => point.y));
      const bottomWorld = Math.max(...corners.map((point) => point.y));
      const minLeftWorld = Math.min(...corners.map((point) => point.x));
      const lastGridX = Math.ceil(rightWorld / GRID_WORLD_STEP) * GRID_WORLD_STEP;
      const firstGridY = Math.floor(topWorld / GRID_WORLD_STEP) * GRID_WORLD_STEP;
      const lastGridY = Math.ceil(bottomWorld / GRID_WORLD_STEP) * GRID_WORLD_STEP;

      const expandedFirstGridX = Math.floor(minLeftWorld / GRID_WORLD_STEP) * GRID_WORLD_STEP;
      const visibleWorldRect = {
        x: minLeftWorld,
        y: topWorld,
        w: Math.max(1, rightWorld - minLeftWorld),
        h: Math.max(1, bottomWorld - topWorld)
      };
      const visibleStyledWays = styledWays.filter((item) => rectsOverlap(item.bounds, visibleWorldRect, GRID_WORLD_STEP));

      context.save();
      context.translate(width / 2, height / 2);
      context.rotate((mapRotationDeg * Math.PI) / 180);
      context.scale(viewState.zoom, viewState.zoom);
      context.translate((viewState.offsetX - width / 2) / Math.max(viewState.zoom, 0.0001), (viewState.offsetY - height / 2) / Math.max(viewState.zoom, 0.0001));
      context.lineCap = "round";
      context.lineJoin = "round";

      context.strokeStyle = "rgba(80, 87, 90, 0.12)";
      context.lineWidth = Math.max(0.5 / Math.max(viewState.zoom, 0.0001), 0.02);
      context.beginPath();
      for (let worldX = expandedFirstGridX; worldX <= lastGridX; worldX += GRID_WORLD_STEP) {
        context.moveTo(worldX, topWorld);
        context.lineTo(worldX, bottomWorld);
      }
      for (let worldY = firstGridY; worldY <= lastGridY; worldY += GRID_WORLD_STEP) {
        context.moveTo(minLeftWorld, worldY);
        context.lineTo(rightWorld, worldY);
      }
      context.stroke();

      visibleStyledWays.forEach(({ way, style }) => {
        if (style.fill && isClosedWay(way)) {
          context.fillStyle = style.fill;
          context.beginPath();
          drawWayPath(context, way);
          context.closePath();
          context.fill();
        }

        if (style.stroke) {
          context.strokeStyle = style.stroke;
          context.lineWidth = style.strokeWidth;
          context.setLineDash(style.lineDash || []);
          context.beginPath();
          drawWayPath(context, way);
          context.stroke();
        }
      });

      context.setLineDash([]);
      visibleStyledWays.forEach(({ way, style }) => {
        const direction = getOnewayDirection(style.tags);
        if (!direction) {
          return;
        }
        drawOnewayArrows(context, way, direction, style.arrowColor || style.stroke || "rgba(41, 65, 73, 0.78)", style.tags || {});
      });

      context.textAlign = "center";
      context.textBaseline = "middle";
      visibleStyledWays.forEach(({ way, style }) => {
        if (!style.hallLabel) {
          return;
        }
        if (hiddenHallLabelSet.has(style.hallLabel)) {
          return;
        }
        if (selectedLevels.length > 0 && !isLevelFocused(style.level, selectedLevels)) {
          return;
        }
        const center = getWayCenter(way);
        drawScreenAlignedOutlinedText(
          context,
          style.hallLabel,
          center.x,
          center.y,
          Math.max(11, 13 / Math.max(viewState.zoom, 0.0001)),
          style.hallLabelColor || "#404246",
          "rgba(255, 255, 255, 0.88)",
          Math.max(1, 2.6 / Math.max(viewState.zoom, 0.0001)),
          mapRotationDeg,
          0
        );
      });
      if (showEditorOverlay && loadedEditorPages.length) {
        const renderedBoothLabels = [];
        loadedEditorPages.forEach((page) => {
          const pageGraph = editorGraphByPage.get(page.page);
          if (!pageGraph) {
            return;
          }
          const pageOverlay = page.page === Number(selectedEditorPageNumber)
            ? editorOverlay
            : normalizeEditorOverlayTransform(editorPageOverlays[String(page.page)]);
          drawEditorOverlayEntities(context, page, pageGraph, pageOverlay, {
            selectedEntityId: page.page === Number(selectedEditorPageNumber) ? selectedEditorEntityId : "",
            showLabels: effectiveShowEditorLabels,
            userMode: isUserMode,
            mapRotationDeg,
            islandLabelSetting: normalizeIslandLabelSetting(editorPageIslandLabelSettings[String(page.page)]),
            circleBoothColorByFullKey: circleBoothColorMaps.colorByFullKey,
            circleBoothLabelByFullKey: circleBoothColorMaps.labelByFullKey,
            circleBoothAbKeySet: circleBoothColorMaps.abKeySet,
            boothLabelOffsets: editorBoothLabelOffsets,
            viewZoom: viewState.zoom,
            projectToScreen: (point) => toScreenPoint(point, drawViewState),
            labelRenderCollector: renderedBoothLabels,
            selectedLabelColorIndexSet
          });
        });
        renderedBoothLabelsRef.current = renderedBoothLabels;
      } else {
        renderedBoothLabelsRef.current = [];
      }
      context.restore();

      frameRef.current = 0;
    }

    function scheduleDraw() {
      if (frameRef.current) {
        return;
      }
      frameRef.current = requestAnimationFrame(draw);
    }

    scheduleDraw();
    const resizeObserver = new ResizeObserver(scheduleDraw);
    resizeObserver.observe(canvas);

    return () => {
      resizeObserver.disconnect();
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
    };
  }, [circleBoothColorMaps, editorBoothLabelOffsets, editorGraphByPage, editorOverlay, editorPageIslandLabelSettings, editorPageOverlays, effectiveShowEditorLabels, isUserMode, loadedEditorPages, mapRotationDeg, selectedEditorEntityId, selectedEditorPageNumber, selectedLabelColorIndexSet, selectedLevels, showEditorOverlay, styledWays, viewState]);

  function toggleSelectedLevel(level) {
    const nextLevel = Number(level);
    if (!USER_MODE_DEFAULT_LEVELS.includes(nextLevel)) {
      return;
    }
    setSelectedLevels([...USER_MODE_DEFAULT_LEVELS]);
  }

  function toggleLabelColorIndex(colorIndex) {
    setSelectedLabelColorIndexes((current) => current.includes(colorIndex)
      ? current.filter((item) => item !== colorIndex)
      : [...current, colorIndex].sort((left, right) => left - right));
  }

  function selectPathHighlight(pathId) {
    const nextPathId = String(pathId || "").trim();
    setSelectedPathHighlightIds(nextPathId ? [nextPathId] : []);
  }

  function toggleHiddenHallLabel(label) {
    setHiddenHallLabels((current) => current.includes(label)
      ? current.filter((item) => item !== label)
      : [...current, label].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })));
  }

  function collectUiPreferences() {
    return normalizeUiPreferences({
      selectedCircleDay,
      selectedPathHighlightIds,
      hiddenHallLabels
    });
  }

  function selectEditorPage(pageNumber) {
    const nextPageNumber = Number(pageNumber);
    setSelectedEditorPageNumber(nextPageNumber);
    setLoadedEditorPageNumbers((current) => current.includes(nextPageNumber) ? current : [...current, nextPageNumber].sort((left, right) => left - right));
    setEditorOverlay(editorPageOverlays[String(nextPageNumber)] || EDITOR_OVERLAY_DEFAULT);
  }

  async function saveEditorTransforms() {
    const overlaysForSave = Object.fromEntries(editorPages.map((page) => [
      String(page.page),
      normalizeEditorOverlayTransform(page.page === Number(selectedEditorPageNumber)
        ? editorOverlay
        : editorPageOverlays[String(page.page)])
    ]));
    const islandLabelSettingsForSave = Object.fromEntries(editorPages.map((page) => [
      String(page.page),
      normalizeIslandLabelSetting(editorPageIslandLabelSettings[String(page.page)])
    ]));
    const pagesForSave = editorPages;
    const payload = buildEditorTransformPayload(
      pagesForSave,
      overlaysForSave,
      islandLabelSettingsForSave,
      editorBoothLabelOffsetsRef.current,
      collectUiPreferences()
    );
    try {
      await saveEditorOverlayTransformsToApi(payload);
      // Keep local copy as a fallback for offline/debug cases.
      window.localStorage.setItem(EDITOR_OVERLAY_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      window.localStorage.setItem(EDITOR_OVERLAY_STORAGE_KEY, JSON.stringify(payload));
    }
  }

  async function saveBoothLabelOffsets() {
    const pagesForSave = editorPages;
    const overlaysForSave = Object.fromEntries(editorPages.map((page) => [
      String(page.page),
      normalizeEditorOverlayTransform(page.page === Number(selectedEditorPageNumber)
        ? editorOverlay
        : editorPageOverlays[String(page.page)])
    ]));
    const islandLabelSettingsForSave = Object.fromEntries(editorPages.map((page) => [
      String(page.page),
      normalizeIslandLabelSetting(editorPageIslandLabelSettings[String(page.page)])
    ]));
    const payload = buildEditorTransformPayload(
      pagesForSave,
      overlaysForSave,
      islandLabelSettingsForSave,
      editorBoothLabelOffsetsRef.current,
      collectUiPreferences()
    );
    try {
      await saveEditorOverlayTransformsToApi(payload);
      window.localStorage.setItem(EDITOR_OVERLAY_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      window.localStorage.setItem(EDITOR_OVERLAY_STORAGE_KEY, JSON.stringify(payload));
    }
  }

  async function saveUiPreferencesToBackend() {
    if (!editorPages.length) {
      return;
    }
    const pagesForSave = editorPages;
    const overlaysForSave = Object.fromEntries(editorPages.map((page) => [
      String(page.page),
      normalizeEditorOverlayTransform(page.page === Number(selectedEditorPageNumber)
        ? editorOverlay
        : editorPageOverlays[String(page.page)])
    ]));
    const islandLabelSettingsForSave = Object.fromEntries(editorPages.map((page) => [
      String(page.page),
      normalizeIslandLabelSetting(editorPageIslandLabelSettings[String(page.page)])
    ]));
    const payload = buildEditorTransformPayload(
      pagesForSave,
      overlaysForSave,
      islandLabelSettingsForSave,
      editorBoothLabelOffsetsRef.current,
      collectUiPreferences()
    );
    try {
      await saveEditorOverlayTransformsToApi(payload);
      window.localStorage.setItem(EDITOR_OVERLAY_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      window.localStorage.setItem(EDITOR_OVERLAY_STORAGE_KEY, JSON.stringify(payload));
    }
  }

  useEffect(() => {
    if (!enableEditTools || !uiPreferencesHydratedRef.current || !editorPages.length) {
      return;
    }
    if (uiPreferencesSaveTimerRef.current) {
      clearTimeout(uiPreferencesSaveTimerRef.current);
    }
    uiPreferencesSaveTimerRef.current = setTimeout(() => {
      uiPreferencesSaveTimerRef.current = null;
      void saveUiPreferencesToBackend();
    }, 500);

    return () => {
      if (uiPreferencesSaveTimerRef.current) {
        clearTimeout(uiPreferencesSaveTimerRef.current);
        uiPreferencesSaveTimerRef.current = null;
      }
    };
  }, [editorPages.length, enableEditTools, hiddenHallLabels, selectedCircleDay, selectedPathHighlightIds]);

  function nudgeEditorOverlay(deltaX, deltaY) {
    setEditorOverlay((current) => ({
      ...current,
      x: roundCoordinate(current.x + deltaX),
      y: roundCoordinate(current.y + deltaY)
    }));
  }

  function scaleEditorOverlay(factor) {
    setEditorOverlay((current) => ({
      ...current,
      scale: Math.max(0.005, roundCoordinate(current.scale * factor))
    }));
  }

  function updateEditorOverlayTransform(field, value) {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
      return;
    }
    setEditorOverlay((current) => ({
      ...current,
      [field]: field === "scale" ? Math.max(0.005, roundCoordinate(nextValue)) : roundCoordinate(nextValue)
    }));
  }

  function updateEditorEntityTransform(field, value) {
    const nextValue = Number(value);
    if (!selectedEditorPage || !selectedEditorEntity || !Number.isFinite(nextValue)) {
      return;
    }
    const nextFieldValue = field === "scale" ? Math.max(0.005, roundCoordinate(nextValue)) : roundCoordinate(nextValue);
    setEditorPages((currentPages) => currentPages.map((page) => {
      if (page.page !== selectedEditorPage.page) {
        return page;
      }
      const updateList = (list) => list.map((entity) => entity.id === selectedEditorEntity.id ? { ...entity, [field]: nextFieldValue } : entity);
      return {
        ...page,
        entities: {
          booths: updateList(page.entities.booths || []),
          groups: updateList(page.entities.groups || []),
          islands: updateList(page.entities.islands || []),
          halls: updateList(page.entities.halls || [])
        }
      };
    }));
  }

  function updateSelectedPageIslandLabelSetting(field, value) {
    if (!selectedEditorPage) {
      return;
    }
    const pageKey = String(selectedEditorPage.page);
    setEditorPageIslandLabelSettings((current) => {
      const next = normalizeIslandLabelSetting(current[pageKey]);
      if (field === "side") {
        next.side = String(value || DEFAULT_ISLAND_LABEL_SETTING.side).toLowerCase();
      } else if (field === "offsetX") {
        next.offsetX = roundCoordinate(asFiniteNumber(value, 0));
      } else if (field === "offsetY") {
        next.offsetY = roundCoordinate(asFiniteNumber(value, 0));
      }
      return {
        ...current,
        [pageKey]: normalizeIslandLabelSetting(next)
      };
    });
  }

  function rotateSelectedEditorEntity(deltaDegrees) {
    if (!selectedEditorEntity) {
      return;
    }
    updateEditorEntityTransform("rotation", asFiniteNumber(selectedEditorEntity.rotation, 0) + deltaDegrees);
  }

  function getCanvasPoint(event) {
    return getCanvasPointFromClient(event.clientX, event.clientY);
  }

  function getCanvasPointFromClient(clientX, clientY) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function getPinchGestureMetrics() {
    const pointers = [...touchPointersRef.current.values()];
    if (pointers.length < 2) {
      return null;
    }
    const [firstPointer, secondPointer] = pointers;
    const dx = secondPointer.x - firstPointer.x;
    const dy = secondPointer.y - firstPointer.y;
    const distance = Math.hypot(dx, dy);
    if (!Number.isFinite(distance) || distance <= 0) {
      return null;
    }
    return {
      distance,
      midpoint: {
        x: (firstPointer.x + secondPointer.x) / 2,
        y: (firstPointer.y + secondPointer.y) / 2
      }
    };
  } 

  function applyZoomAtCanvasPoint(canvasPoint, zoomFactor) {
    if (!canvasPoint || !Number.isFinite(zoomFactor) || zoomFactor <= 0) {
      return;
    }

    scheduleViewStateUpdate((current) => {
      const nextZoom = clamp(current.zoom * zoomFactor, 0.03, 80);
      if (Math.abs(nextZoom - current.zoom) < 0.000001) {
        return current;
      }
      const viewportWidth = canvasRef.current?.clientWidth || 0;
      const viewportHeight = canvasRef.current?.clientHeight || 0;
      const rotationState = { ...current, rotationDeg: mapRotationDeg, viewportWidth, viewportHeight };
      const worldPoint = toWorldPoint(canvasPoint, rotationState);
      const rotationRad = (mapRotationDeg * Math.PI) / 180;
      const cos = Math.cos(rotationRad);
      const sin = Math.sin(rotationRad);
      const centerX = viewportWidth > 0 ? viewportWidth / 2 : current.offsetX;
      const centerY = viewportHeight > 0 ? viewportHeight / 2 : current.offsetY;
      const rotatedX = canvasPoint.x - centerX;
      const rotatedY = canvasPoint.y - centerY;
      const localX = rotatedX * cos + rotatedY * sin;
      const localY = -rotatedX * sin + rotatedY * cos;
      return {
        zoom: nextZoom,
        offsetX: localX - worldPoint.x * nextZoom + centerX,
        offsetY: localY - worldPoint.y * nextZoom + centerY
      };
    });
  }

  function scheduleViewStateUpdate(updater) {
    const previousUpdater = pendingViewUpdateRef.current;
    pendingViewUpdateRef.current = previousUpdater
      ? (current) => updater(previousUpdater(current))
      : updater;

    if (viewUpdateFrameRef.current) {
      return;
    }

    viewUpdateFrameRef.current = requestAnimationFrame(() => {
      viewUpdateFrameRef.current = 0;
      const nextUpdater = pendingViewUpdateRef.current;
      pendingViewUpdateRef.current = null;
      if (!nextUpdater) {
        return;
      }
      setViewState((current) => {
        const next = nextUpdater(current);
        viewStateRef.current = next;
        return next;
      });
    });
  }

  function scheduleBoothLabelOffset(labelKey, offset) {
    pendingBoothLabelOffsetsRef.current = {
      ...pendingBoothLabelOffsetsRef.current,
      [labelKey]: offset
    };

    if (boothLabelOffsetFrameRef.current) {
      return;
    }

    boothLabelOffsetFrameRef.current = requestAnimationFrame(() => {
      boothLabelOffsetFrameRef.current = 0;
      const pendingOffsets = pendingBoothLabelOffsetsRef.current;
      pendingBoothLabelOffsetsRef.current = {};
      if (!Object.keys(pendingOffsets).length) {
        return;
      }
      setEditorBoothLabelOffsets((current) => {
        const next = { ...current, ...pendingOffsets };
        editorBoothLabelOffsetsRef.current = next;
        return next;
      });
    });
  }

  function flushBoothLabelOffsets() {
    const pendingOffsets = pendingBoothLabelOffsetsRef.current;
    pendingBoothLabelOffsetsRef.current = {};
    if (boothLabelOffsetFrameRef.current) {
      cancelAnimationFrame(boothLabelOffsetFrameRef.current);
      boothLabelOffsetFrameRef.current = 0;
    }
    if (!Object.keys(pendingOffsets).length) {
      return;
    }
    setEditorBoothLabelOffsets((current) => {
      const next = { ...current, ...pendingOffsets };
      editorBoothLabelOffsetsRef.current = next;
      return next;
    });
  }

  function scheduleHoverHit(canvasPoint) {
    pendingHoverCanvasPointRef.current = canvasPoint;
    if (hoverHitFrameRef.current) {
      return;
    }

    hoverHitFrameRef.current = requestAnimationFrame(() => {
      hoverHitFrameRef.current = 0;
      const pendingPoint = pendingHoverCanvasPointRef.current;
      pendingHoverCanvasPointRef.current = null;
      if (!pendingPoint) {
        setIsHoverClickableBooth(false);
        return;
      }
      const worldPoint = toWorldPoint(pendingPoint, {
        ...viewStateRef.current,
        rotationDeg: mapRotationDeg,
        viewportWidth: canvasRef.current?.clientWidth || 0,
        viewportHeight: canvasRef.current?.clientHeight || 0
      });
      const hitResult = findOverlayHitAtWorldPoint(worldPoint);
      const nextHoverClickable = isClickableBoothHit(hitResult);
      setIsHoverClickableBooth((current) => current === nextHoverClickable ? current : nextHoverClickable);
    });
  }

  function handlePointerDown(event) {
    if (event.pointerType !== "mouse") {
      touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPointersRef.current.size >= 2) {
        const pinchMetrics = getPinchGestureMetrics();
        if (pinchMetrics) {
          event.preventDefault();
          pinchStateRef.current = { active: true, lastDistance: pinchMetrics.distance };
          dragStateRef.current = { type: "none", pointerId: null, lastX: 0, lastY: 0 };
          setIsPanning(false);
          canvasRef.current?.setPointerCapture(event.pointerId);
          return;
        }
      }
    }

    const beginPanDrag = () => {
      event.preventDefault();
      dragStateRef.current = { type: "pan", pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
      setIsPanning(true);
      canvasRef.current?.setPointerCapture(event.pointerId);
    };

    if (enableEditTools && event.button === 0 && !isSpacePressed && showEditorOverlay) {
      const canvasPoint = getCanvasPoint(event);
      if (canvasPoint) {
        const labelHit = findDraggableLabelAtCanvasPoint(canvasPoint);
        if (labelHit) {
          const worldPoint = toWorldPoint(canvasPoint, {
            ...viewState,
            rotationDeg: mapRotationDeg,
            viewportWidth: canvasRef.current?.clientWidth || 0,
            viewportHeight: canvasRef.current?.clientHeight || 0
          });
          event.preventDefault();
          dragStateRef.current = {
            type: "booth-label",
            pointerId: event.pointerId,
            lastX: event.clientX,
            lastY: event.clientY,
            labelKey: labelHit.key,
            boothCenterWorld: labelHit.boothCenterWorld,
            grabDx: worldPoint.x - labelHit.anchorWorld.x,
            grabDy: worldPoint.y - labelHit.anchorWorld.y
          };
          canvasRef.current?.setPointerCapture(event.pointerId);
          return;
        }
      }
    }

    if (event.button === 0 && isUserMode && !isSpacePressed) {
      const canvasPoint = getCanvasPoint(event);
      if (!canvasPoint) {
        setSelectedBoothCircle(null);
        return;
      }
      if (!showEditorOverlay) {
        beginPanDrag();
        return;
      }
      const worldPoint = toWorldPoint(canvasPoint, {
        ...viewState,
        rotationDeg: mapRotationDeg,
        viewportWidth: canvasRef.current?.clientWidth || 0,
        viewportHeight: canvasRef.current?.clientHeight || 0
      });
      const hitResult = findOverlayHitAtWorldPoint(worldPoint);
      if (!hitResult || hitResult.type !== "booth") {
        setSelectedBoothCircle(null);
        beginPanDrag();
        return;
      }
      const matchedCircle = resolveBoothCircle(hitResult.entity, hitResult.graph);
      if (!matchedCircle) {
        setSelectedBoothCircle(null);
        beginPanDrag();
        return;
      }
      setSelectedBoothCircle(matchedCircle);
      return;
    }
    if (enableEditTools && event.button === 0 && !isSpacePressed && isEditorOverlayMoveMode && showEditorOverlay && selectedEditorPage) {
      event.preventDefault();
      dragStateRef.current = { type: "editor-overlay", pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
      canvasRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0 || !isSpacePressed) {
      return;
    }
    beginPanDrag();
  }

  function handlePointerMove(event) {
    if (event.pointerType !== "mouse" && touchPointersRef.current.has(event.pointerId)) {
      touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (event.pointerType !== "mouse" && (pinchStateRef.current.active || touchPointersRef.current.size >= 2)) {
      const pinchMetrics = getPinchGestureMetrics();
      if (pinchMetrics) {
        event.preventDefault();
        const previousDistance = asFiniteNumber(pinchStateRef.current.lastDistance, pinchMetrics.distance);
        pinchStateRef.current = { active: true, lastDistance: pinchMetrics.distance };
        if (previousDistance > 0) {
          const zoomFactor = pinchMetrics.distance / previousDistance;
          if (Number.isFinite(zoomFactor) && Math.abs(zoomFactor - 1) > 0.001) {
            const anchorPoint = getCanvasPointFromClient(pinchMetrics.midpoint.x, pinchMetrics.midpoint.y);
            applyZoomAtCanvasPoint(anchorPoint, zoomFactor);
          }
        }
        dragStateRef.current = { type: "none", pointerId: null, lastX: 0, lastY: 0 };
        setIsPanning(false);
        return;
      }
    }

    if (dragStateRef.current.type === "booth-label" && dragStateRef.current.pointerId === event.pointerId) {
      event.preventDefault();
      const canvasPoint = getCanvasPoint(event);
      if (!canvasPoint) {
        return;
      }
      const worldPoint = toWorldPoint(canvasPoint, {
        ...viewState,
        rotationDeg: mapRotationDeg,
        viewportWidth: canvasRef.current?.clientWidth || 0,
        viewportHeight: canvasRef.current?.clientHeight || 0
      });
      const nextAnchor = {
        x: worldPoint.x - asFiniteNumber(dragStateRef.current.grabDx, 0),
        y: worldPoint.y - asFiniteNumber(dragStateRef.current.grabDy, 0)
      };
      const center = dragStateRef.current.boothCenterWorld || { x: 0, y: 0 };
      const labelKey = String(dragStateRef.current.labelKey || "");
      if (!labelKey) {
        return;
      }
      scheduleBoothLabelOffset(labelKey, {
        dx: roundCoordinate(nextAnchor.x - center.x),
        dy: roundCoordinate(nextAnchor.y - center.y)
      });
      dragStateRef.current.lastX = event.clientX;
      dragStateRef.current.lastY = event.clientY;
      return;
    }

    if (dragStateRef.current.type === "editor-overlay" && dragStateRef.current.pointerId === event.pointerId) {
      event.preventDefault();
      const screenDx = event.clientX - dragStateRef.current.lastX;
      const screenDy = event.clientY - dragStateRef.current.lastY;
      const localDx = screenDx / Math.max(viewState.zoom, 0.0001);
      const localDy = screenDy / Math.max(viewState.zoom, 0.0001);
      const rotationRad = (mapRotationDeg * Math.PI) / 180;
      const cos = Math.cos(rotationRad);
      const sin = Math.sin(rotationRad);
      const resolvedDx = localDx * cos + localDy * sin;
      const dy = -localDx * sin + localDy * cos;
      dragStateRef.current.lastX = event.clientX;
      dragStateRef.current.lastY = event.clientY;
      nudgeEditorOverlay(resolvedDx, dy);
      return;
    }
    if (dragStateRef.current.type !== "pan" || dragStateRef.current.pointerId !== event.pointerId) {
      if (isUserMode && !isSpacePressed && showEditorOverlay) {
        const canvasPoint = getCanvasPoint(event);
        if (!canvasPoint) {
          setIsHoverClickableBooth(false);
          return;
        }
        scheduleHoverHit(canvasPoint);
      } else {
        setIsHoverClickableBooth(false);
      }
      return;
    }
    event.preventDefault();
    const dx = event.clientX - dragStateRef.current.lastX;
    const dy = event.clientY - dragStateRef.current.lastY;
    dragStateRef.current.lastX = event.clientX;
    dragStateRef.current.lastY = event.clientY;
    const rotationRad = (mapRotationDeg * Math.PI) / 180;
    const cos = Math.cos(rotationRad);
    const sin = Math.sin(rotationRad);
    scheduleViewStateUpdate((current) => ({
      ...current,
      offsetX: current.offsetX + dx * cos + dy * sin,
      offsetY: current.offsetY - dx * sin + dy * cos
    }));
  }

  function endPointerPan(pointerId) {
    if (touchPointersRef.current.has(pointerId)) {
      touchPointersRef.current.delete(pointerId);
    }
    if (touchPointersRef.current.size < 2) {
      pinchStateRef.current = { active: false, lastDistance: 0 };
    }

    if (dragStateRef.current.pointerId !== pointerId) {
      return;
    }
    const shouldSaveLabelOffsets = dragStateRef.current.type === "booth-label";
    dragStateRef.current = { type: "none", pointerId: null, lastX: 0, lastY: 0 };
    setIsPanning(false);
    if (shouldSaveLabelOffsets) {
      flushBoothLabelOffsets();
      void saveBoothLabelOffsets();
    }
  }

  function handleWheel(event) {
    event.preventDefault();
    const canvasPoint = getCanvasPoint(event);
    if (!canvasPoint) {
      return;
    }
    applyZoomAtCanvasPoint(canvasPoint, Math.exp(-event.deltaY * 0.0015));
  }

  async function handleGyroRotationToggle(checked) {
    if (!checked) {
      setUseGyroRotation(false);
      setMapRotationDeg(34);
      return;
    }

    if (!gyroSupported) {
      setUseGyroRotation(false);
      return;
    }

    const requestPermission = window.DeviceOrientationEvent?.requestPermission;
    if (typeof requestPermission === "function") {
      try {
        const result = await requestPermission();
        if (result !== "granted") {
          setUseGyroRotation(false);
          return;
        }
      } catch {
        setUseGyroRotation(false);
        return;
      }
    }

    setUseGyroRotation(true);
  }

  return (
    <Box sx={{ position: "relative", width: "100%", height: "100vh", overflow: "hidden", bgcolor: "#f6f4ef" }}>
      <Box
        sx={{
          position: "fixed",
          top: 62,
          right: 16,
          zIndex: (theme) => theme.zIndex.appBar,
          display: "flex",
          alignItems: "flex-start",
          gap: 0.75
        }}
      >
        <Button
          variant="contained"
          size="small"
          onClick={() => setIsRightPanelCollapsed((current) => !current)}
          sx={{
            minWidth: 30,
            width: 30,
            height: 96,
            px: 0.2,
            py: 0.5,
            borderRadius: 1,
            bgcolor: "#2b2f34",
            color: "#fefcf7",
            writingMode: "vertical-rl",
            textOrientation: "mixed",
            letterSpacing: 1,
            "&:hover": { bgcolor: "#1f2327" }
          }}
        >
          {isRightPanelCollapsed ? "展开面板" : "收起面板"}
        </Button>
        {!isRightPanelCollapsed ? <Stack spacing={1.25} sx={{ width: 220 }}>
          <Paper
            elevation={4}
            sx={{
              border: "1px solid #d9d4c6",
              bgcolor: "rgba(255, 255, 255, 0.9)",
              backdropFilter: "blur(3px)",
              overflow: "hidden"
            }}
          >
            <Stack spacing={1} sx={{ p: 1.25 }}>
              <FormControl size="small" fullWidth>
                <InputLabel id="circle-day-select-label">日期</InputLabel>
                <Select
                  labelId="circle-day-select-label"
                  label="日期"
                  value={selectedCircleDay}
                  onChange={(event) => setSelectedCircleDay(String(event.target.value))}
                >
                  <MenuItem value="day1">一日目(土)</MenuItem>
                  <MenuItem value="day2">二日目(日)</MenuItem>
                </Select>
              </FormControl>
              <Accordion
                disableGutters
                elevation={0}
                expanded={isColorFilterPanelOpen}
                onChange={(_, expanded) => setIsColorFilterPanelOpen(expanded)}
                sx={{ bgcolor: "transparent", "&::before": { display: "none" } }}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 36, px: 0.25, "& .MuiAccordionSummary-content": { my: 0 } }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>颜色筛选</Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ px: 0, py: 0 }}>
                  <List dense disablePadding>
                  {COLOR_INDEX_OPTIONS.map((colorIndex) => {
                    const checked = selectedLabelColorIndexes.includes(colorIndex);
                    return (
                      <ListItem
                        key={colorIndex}
                        disableGutters
                        dense
                        secondaryAction={<Checkbox edge="end" size="small" checked={checked} disabled onChange={() => toggleLabelColorIndex(colorIndex)} />}
                        sx={{ py: 0, pr: 0 }}
                      >
                        <ListItemIcon sx={{ minWidth: 22 }}>
                          <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: badgeColor(colorIndex), border: "1px solid rgba(0,0,0,0.14)" }} />
                        </ListItemIcon>
                        <ListItemText primary={COLOR_LABELS[colorIndex]} primaryTypographyProps={{ fontSize: 12, lineHeight: 1.2 }} />
                      </ListItem>
                    );
                  })}
                  </List>
                </AccordionDetails>
              </Accordion>
              <Accordion
                disableGutters
                elevation={0}
                expanded={isLevelPanelOpen}
                onChange={(_, expanded) => setIsLevelPanelOpen(expanded)}
                sx={{ bgcolor: "transparent", "&::before": { display: "none" } }}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 36, px: 0.25, "& .MuiAccordionSummary-content": { my: 0 } }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>层级</Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ px: 0, py: 0 }}>
                  <List dense disablePadding>
                  {[1, 2, 3, 4].map((level) => (
                    <ListItem
                      key={level}
                      disableGutters
                      dense
                      secondaryAction={<Checkbox edge="end" size="small" checked={selectedLevels.includes(level)} disabled />}
                      sx={{ py: 0, pr: 0 }}
                    >
                      <ListItemText primary={`L${level}`} primaryTypographyProps={{ fontSize: 12, lineHeight: 1.2 }} />
                    </ListItem>
                  ))}
                  </List>
                </AccordionDetails>
              </Accordion>
              <Stack spacing={0.5}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>地图旋转</Typography>
                <Slider
                  value={mapRotationDeg}
                  min={-180}
                  max={180}
                  step={1}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(value) => `${value}°`}
                  onChange={(_, nextValue) => {
                    const nextRotation = Array.isArray(nextValue) ? nextValue[0] : nextValue;
                    if (Number.isFinite(nextRotation)) {
                      setMapRotationDeg(roundCoordinate(clamp(nextRotation, -180, 180)));
                    }
                  }}
                />
                <FormControlLabel
                  control={(
                    <Checkbox
                      size="small"
                      checked={useGyroRotation}
                      onChange={(event) => {
                        void handleGyroRotationToggle(event.target.checked);
                      }}
                      disabled={!gyroSupported}
                    />
                  )}
                  label="陀螺仪旋转"
                  sx={{ m: 0, "& .MuiFormControlLabel-label": { fontSize: 12 } }}
                />
              </Stack>
            </Stack>
          </Paper>

          <Paper
            elevation={4}
            sx={{
              border: "1px solid #d9d4c6",
              bgcolor: "rgba(255, 255, 255, 0.9)",
              backdropFilter: "blur(3px)"
            }}
          >
            <Stack spacing={1} sx={{ p: 1.25 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>路径高亮</Typography>
              <FormControl size="small" fullWidth>
                <InputLabel id="path-highlight-select-label">高亮类型</InputLabel>
                <Select
                  labelId="path-highlight-select-label"
                  label="高亮类型"
                  value={selectedPathHighlightIds[0] || ""}
                  onChange={(event) => selectPathHighlight(event.target.value)}
                >
                  <MenuItem value="">无</MenuItem>
                  {PATH_HIGHLIGHT_OPTIONS.map((option) => (
                    <MenuItem key={option.id} value={option.id}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
          </Paper>
        </Stack> : null}
      </Box>
      {enableEditTools && !isUserMode ? <Box
        sx={{
          position: "fixed",
          top: 72,
          left: 16,
          zIndex: (theme) => theme.zIndex.appBar
        }}
      >
        <Stack direction="row" spacing={1.25} alignItems="flex-start">
          <Paper
            elevation={4}
            sx={{
              p: 1.5,
              width: 240,
              border: "1px solid #d9d4c6",
              bgcolor: "rgba(255, 255, 255, 0.9)",
              backdropFilter: "blur(3px)"
            }}
          >
            <Stack spacing={1.25}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>编辑叠加</Typography>
            <FormControl size="small" fullWidth disabled={!editorPages.length}>
              <InputLabel id="editor-page-select-label">页面</InputLabel>
              <Select
                labelId="editor-page-select-label"
                label="页面"
                value={selectedEditorPage?.page || selectedEditorPageNumber}
                onChange={(event) => selectEditorPage(event.target.value)}
              >
                {editorPages.map((page) => (
                  <MenuItem key={page.page} value={page.page}>Page {page.page}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Stack direction="row" spacing={0.75}>
              <TextField
                size="small"
                label="X"
                type="number"
                value={editorOverlay.x}
                disabled={!editorPages.length}
                onChange={(event) => updateEditorOverlayTransform("x", event.target.value)}
                inputProps={{ step: 1 }}
              />
              <TextField
                size="small"
                label="Y"
                type="number"
                value={editorOverlay.y}
                disabled={!editorPages.length}
                onChange={(event) => updateEditorOverlayTransform("y", event.target.value)}
                inputProps={{ step: 1 }}
              />
            </Stack>
            <TextField
              size="small"
              label="Scale"
              type="number"
              value={editorOverlay.scale}
              disabled={!editorPages.length}
              onChange={(event) => updateEditorOverlayTransform("scale", event.target.value)}
              inputProps={{ step: 0.001, min: 0.005 }}
            />
            <FormControl size="small" fullWidth disabled={!selectedEditorPage}>
              <InputLabel id="island-label-side-select-label">标签位置</InputLabel>
              <Select
                labelId="island-label-side-select-label"
                label="标签位置"
                value={selectedEditorPageIslandLabelSetting.side}
                onChange={(event) => updateSelectedPageIslandLabelSetting("side", event.target.value)}
              >
                <MenuItem value="top">上</MenuItem>
                <MenuItem value="right">右</MenuItem>
                <MenuItem value="bottom">下</MenuItem>
                <MenuItem value="left">左</MenuItem>
                <MenuItem value="center">中</MenuItem>
              </Select>
            </FormControl>
            <Stack direction="row" spacing={0.75}>
              <TextField
                size="small"
                label="标签X"
                type="number"
                value={selectedEditorPageIslandLabelSetting.offsetX}
                disabled={!selectedEditorPage}
                onChange={(event) => updateSelectedPageIslandLabelSetting("offsetX", event.target.value)}
                inputProps={{ step: 1 }}
              />
              <TextField
                size="small"
                label="标签Y"
                type="number"
                value={selectedEditorPageIslandLabelSetting.offsetY}
                disabled={!selectedEditorPage}
                onChange={(event) => updateSelectedPageIslandLabelSetting("offsetY", event.target.value)}
                inputProps={{ step: 1 }}
              />
            </Stack>
            <FormControl size="small" fullWidth disabled={!editorEntityOptions.length}>
              <InputLabel id="editor-entity-select-label">对象</InputLabel>
              <Select
                labelId="editor-entity-select-label"
                label="对象"
                value={selectedEditorEntity?.id || ""}
                onChange={(event) => setSelectedEditorEntityId(String(event.target.value))}
              >
                {editorEntityOptions.map((entity) => (
                  <MenuItem key={entity.id} value={entity.id}>{entity.type}: {entity.raw || entity.boothNumber || entity.id}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Stack direction="row" spacing={0.75}>
              <TextField
                size="small"
                label="X"
                type="number"
                value={selectedEditorEntity?.x ?? ""}
                disabled={!selectedEditorEntity}
                onChange={(event) => updateEditorEntityTransform("x", event.target.value)}
                inputProps={{ step: 1 }}
              />
              <TextField
                size="small"
                label="Y"
                type="number"
                value={selectedEditorEntity?.y ?? ""}
                disabled={!selectedEditorEntity}
                onChange={(event) => updateEditorEntityTransform("y", event.target.value)}
                inputProps={{ step: 1 }}
              />
            </Stack>
            <Stack direction="row" spacing={0.75}>
              <TextField
                size="small"
                label="Rotation"
                type="number"
                value={selectedEditorEntity?.rotation ?? ""}
                disabled={!selectedEditorEntity}
                onChange={(event) => updateEditorEntityTransform("rotation", event.target.value)}
                inputProps={{ step: 1 }}
              />
              <TextField
                size="small"
                label="缩放"
                type="number"
                value={selectedEditorEntity?.scale ?? ""}
                disabled={!selectedEditorEntity}
                onChange={(event) => updateEditorEntityTransform("scale", event.target.value)}
                inputProps={{ step: 0.001, min: 0.005 }}
              />
            </Stack>
            <Stack direction="row" spacing={0.75}>
              <Button size="small" variant="outlined" disabled={!selectedEditorEntity} onClick={() => rotateSelectedEditorEntity(-5)}>左转</Button>
              <Button size="small" variant="outlined" disabled={!selectedEditorEntity} onClick={() => rotateSelectedEditorEntity(5)}>右转</Button>
            </Stack>
            <Stack spacing={0.25}>
              <FormControlLabel
                control={<Checkbox size="small" checked={showEditorOverlay} disabled={!editorPages.length} onChange={(event) => setShowEditorOverlay(event.target.checked)} />}
                label="显示叠加"
                sx={{ m: 0, "& .MuiFormControlLabel-label": { fontSize: 13 } }}
              />
              <FormControlLabel
                control={<Checkbox size="small" checked={showEditorLabels} disabled={!editorPages.length} onChange={(event) => setShowEditorLabels(event.target.checked)} />}
                label="显示标签"
                sx={{ m: 0, "& .MuiFormControlLabel-label": { fontSize: 13 } }}
              />
              <FormControlLabel
                control={<Checkbox size="small" checked={isEditorOverlayMoveMode} disabled={!editorPages.length || !showEditorOverlay} onChange={(event) => setIsEditorOverlayMoveMode(event.target.checked)} />}
                label="拖拽移动"
                sx={{ m: 0, "& .MuiFormControlLabel-label": { fontSize: 13 } }}
              />
            </Stack>
            <Stack spacing={0.5} alignItems="center">
              <Button size="small" variant="outlined" disabled={!editorPages.length} onClick={() => nudgeEditorOverlay(0, -EDITOR_OVERLAY_NUDGE)}>上</Button>
              <Stack direction="row" spacing={0.5}>
                <Button size="small" variant="outlined" disabled={!editorPages.length} onClick={() => nudgeEditorOverlay(-EDITOR_OVERLAY_NUDGE, 0)}>左</Button>
                <Button size="small" variant="outlined" disabled={!editorPages.length} onClick={() => nudgeEditorOverlay(EDITOR_OVERLAY_NUDGE, 0)}>右</Button>
              </Stack>
              <Button size="small" variant="outlined" disabled={!editorPages.length} onClick={() => nudgeEditorOverlay(0, EDITOR_OVERLAY_NUDGE)}>下</Button>
            </Stack>
            <Stack direction="row" spacing={0.75}>
              <Button size="small" variant="outlined" disabled={!editorPages.length} onClick={() => scaleEditorOverlay(0.9)}>缩小</Button>
              <Button size="small" variant="outlined" disabled={!editorPages.length} onClick={() => scaleEditorOverlay(1.1)}>放大</Button>
            </Stack>
            <Stack direction="row" spacing={0.75}>
              <Button size="small" variant="contained" disabled={!editorPages.length} onClick={saveEditorTransforms}>保存</Button>
              <Button size="small" variant="text" disabled={!editorPages.length} onClick={() => setEditorOverlay(EDITOR_OVERLAY_DEFAULT)}>重置叠加</Button>
            </Stack>
            </Stack>
          </Paper>

          <Paper
            elevation={4}
            sx={{
              width: 220,
              border: "1px solid #d9d4c6",
              bgcolor: "rgba(255, 255, 255, 0.9)",
              backdropFilter: "blur(3px)",
              overflow: "hidden"
            }}
          >
            <Button
              fullWidth
              size="small"
              onClick={() => setIsHallLabelPanelOpen((current) => !current)}
              endIcon={
                <ExpandMoreIcon
                  sx={{
                    transform: isHallLabelPanelOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 180ms ease"
                  }}
                />
              }
              sx={{
                justifyContent: "space-between",
                px: 1.25,
                py: 0.75,
                borderRadius: 0,
                color: "#2b2f34",
                fontWeight: 700,
                borderBottom: "1px solid #e7dfd3",
                textTransform: "none"
              }}
            >
              隐藏馆标签
            </Button>
            <Collapse in={isHallLabelPanelOpen} timeout="auto" unmountOnExit={false} collapsedSize={0}>
              <Stack spacing={0.75} sx={{ p: 1.25, maxHeight: "calc(100vh - 180px)", overflowY: "auto" }}>
                <Stack spacing={0.15}>
                  {hallLabelOptions.length ? hallLabelOptions.map((option) => (
                    <FormControlLabel
                      key={option.label}
                      control={<Checkbox size="small" checked={hiddenHallLabels.includes(option.label)} onChange={() => toggleHiddenHallLabel(option.label)} sx={{ p: 0.18 }} />}
                      label={<Typography sx={{ fontSize: 11.5, lineHeight: 1.1, color: option.color, fontWeight: 700 }}>{option.label}</Typography>}
                      sx={{ m: 0, alignItems: "flex-start", "& .MuiFormControlLabel-label": { mt: "2px" } }}
                    />
                  )) : null}
                </Stack>
              </Stack>
            </Collapse>
          </Paper>
        </Stack>
      </Box> : null}
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => endPointerPan(event.pointerId)}
        onPointerCancel={(event) => endPointerPan(event.pointerId)}
        onPointerLeave={() => setIsHoverClickableBooth(false)}
        onWheel={handleWheel}
        style={{ width: "100%", height: "100%", display: "block", cursor: canvasCursor, touchAction: "none" }}
      />
      <Box sx={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        {stationMarkerRenderData.map((marker) => (
          <Box
            key={marker.id}
            title={marker.ref}
            sx={{
              position: "absolute",
              left: marker.screenPoint.x,
              top: marker.screenPoint.y,
              transform: `translate(-50%, -50%) scale(${viewState.zoom * marker.scale})`,
              transformOrigin: "center",
              zIndex: 3,
              fontFamily: "sans-serif",
              "& *": { fontFamily: "inherit" },
              "& span span": { transform: "translateX(-1px)" }
            }}
            dangerouslySetInnerHTML={{ __html: marker.html }}
          />
        ))}
      </Box>
      <CircleDetailDrawer
        selected={selectedBoothCircle}
        open={Boolean(selectedBoothCircle)}
        onClose={() => setSelectedBoothCircle(null)}
        imageBaseUrl={STORAGE_BASE_URL}
      />
    </Box>
  );
}

function normalizeBoothSuffix(value) {
  const suffix = String(value || "").trim().toLowerCase();
  return suffix === "a" || suffix === "b" ? suffix : "";
}

function normalizeIslandCode(value) {
  return toHalfwidthLatin(String(value || "")).trim();
}

function findBoothIslandCodeFromGraph(graph, boothEntity) {
  if (!graph || !boothEntity?.parentId) {
    return "";
  }
  let cursor = graph.byId.get(boothEntity.parentId);
  while (cursor) {
    if (cursor.type === "island") {
      return normalizeIslandCode(cursor.raw);
    }
    if (!cursor.parentId) {
      break;
    }
    cursor = graph.byId.get(cursor.parentId);
  }
  return "";
}

function isPointInPolygon(point, polygon) {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) {
    return false;
  }

  const isPointOnSegment = (testPoint, a, b) => {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = testPoint.x - a.x;
    const apy = testPoint.y - a.y;
    const cross = abx * apy - aby * apx;
    if (Math.abs(cross) > 0.000001) {
      return false;
    }
    const dot = apx * abx + apy * aby;
    if (dot < -0.000001) {
      return false;
    }
    const abLenSq = abx * abx + aby * aby;
    if (dot - abLenSq > 0.000001) {
      return false;
    }
    return true;
  };

  // Treat boundary as a hit so clicking edges/corners is stable.
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (isPointOnSegment(point, polygon[j], polygon[i])) {
      return true;
    }
  }

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi);
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function buildCircleBoothColorMaps(circles, day) {
  const colorByFullKey = new Map();
  const labelByFullKey = new Map();
  const abKeySet = new Set();

  (circles || []).forEach((circle) => {
    const location = String(circle?.booth_location || "").trim();
    if (!location || getDayCategory(location) !== day) {
      return;
    }
    const parsed = parseLocation(location);
    if (!parsed?.isValid) {
      return;
    }
    const colorIndex = Number(circle?.color_index);
    const colorValue = badgeColor(colorIndex);
    if (!colorValue) {
      return;
    }

    const islandKey = normalizeIslandCode(parsed.islandCode);
    const boothNumberText = String(parsed.boothNumber || "").trim();
    if (!boothNumberText) {
      return;
    }

    const suffixText = String(parsed.suffixText || "").toLowerCase();
    if (suffixText === "ab") {
      abKeySet.add(`${islandKey}|${boothNumberText}`);
    }
    const suffixes = suffixText === "ab" ? ["a", "b"] : suffixText ? [suffixText] : ["a", "b", ""];

    suffixes.forEach((suffix) => {
      const normalizedSuffix = normalizeBoothSuffix(suffix);
      const fullKey = `${islandKey}|${boothNumberText}|${normalizedSuffix}`;
      if (!colorByFullKey.has(fullKey)) {
        colorByFullKey.set(fullKey, colorValue);
      }
      if (!labelByFullKey.has(fullKey)) {
        labelByFullKey.set(fullKey, {
          colorIndex,
          circleName: String(circle?.circle_name || "").trim(),
          authorName: String(circle?.author_name || "").trim()
        });
      }
    });
  });

  return { colorByFullKey, labelByFullKey, abKeySet };
}

function withAlpha(color, alpha = 0.32) {
  const value = String(color || "").trim();
  const safeAlpha = clamp(asFiniteNumber(alpha, 0.32), 0, 1);
  const hex = value.match(/^#([0-9a-fA-F]{6})$/);
  if (hex) {
    const raw = hex[1];
    const r = Number.parseInt(raw.slice(0, 2), 16);
    const g = Number.parseInt(raw.slice(2, 4), 16);
    const b = Number.parseInt(raw.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
  }
  return value;
}

function polygonArea(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    return Number.POSITIVE_INFINITY;
  }
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    sum += (polygon[j].x * polygon[i].y) - (polygon[i].x * polygon[j].y);
  }
  return Math.abs(sum) / 2;
}