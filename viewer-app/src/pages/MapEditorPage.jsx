import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { withApiBaseUrl } from "../utils/apiBase.js";
import { MapExtractionActions } from "../components/MapExtractionActions";

const MAP_EXTRACTION_API = withApiBaseUrl("/api/map/extraction");
const MAP_EDITOR_SNAPSHOTS_API = withApiBaseUrl("/api/map/editor-snapshots");
const IMAGE_BASE_URL = import.meta.env.VITE_IMAGE_BASE_URL || withApiBaseUrl("");
const ALLOWED_BOOTH_SUFFIXES = ["", "a", "b", "ab"];
const HIRAGANA_SEQUENCE = [
  "あ", "い", "う", "え", "お",
  "か", "き", "く", "け", "こ",
  "さ", "し", "す", "せ", "そ",
  "た", "ち", "つ", "て", "と",
  "な", "に", "ぬ", "ね", "の",
  "は", "ひ", "ふ", "へ", "ほ",
  "ま", "み", "む", "め", "も",
  "や", "ゆ", "よ",
  "ら", "り", "る", "れ", "ろ",
  "わ", "を", "ん"
];
const ISLAND_SEQUENCE_DIRECTIONS = [
  { value: "left-to-right", label: "左→右", symbol: "→" },
  { value: "right-to-left", label: "右→左", symbol: "←" },
  { value: "top-to-bottom", label: "上→下", symbol: "↓" },
  { value: "bottom-to-top", label: "下→上", symbol: "↑" }
];
const ISLAND_NUMBERING_CORNERS = [
  { value: "top-left", label: "↖ 左上" },
  { value: "top-right", label: "↗ 右上" },
  { value: "bottom-left", label: "↙ 左下" },
  { value: "bottom-right", label: "↘ 右下" }
];
const PAGE_ISLAND_RAW_SEQUENCES = [
  { label: "Katakana", start: "ア", values: HIRAGANA_SEQUENCE.map(hiraganaToKatakana) },
  { label: "Uppercase", start: "A/Ａ", values: Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)), normalize: (raw) => raw.replace(/[Ａ-Ｚ]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0)) },
  { label: "Hiragana", start: "あ", values: HIRAGANA_SEQUENCE },
  { label: "Lowercase", start: "a/ａ", values: Array.from({ length: 26 }, (_, index) => String.fromCharCode(97 + index)), normalize: (raw) => raw.replace(/[ａ-ｚ]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0)) }
];
const ENTITY_STYLE = {
  hall: { stroke: "rgba(242, 133, 49, 0.85)", fill: "rgba(252, 181, 112, 0.05)" },
  island: { stroke: "rgba(176, 132, 255, 0.9)", fill: "rgba(196, 166, 255, 0.07)" },
  group: { stroke: "rgba(81, 168, 93, 0.9)", fill: "rgba(124, 208, 132, 0.06)" },
  booth: { stroke: "rgba(0, 117, 190, 0.85)", fill: "rgba(0, 140, 255, 0.12)" }
};
const ENTITY_PARENT_TYPE = {
  booth: "group",
  group: "island",
  island: "hall"
};
const HALL_MOVE_HANDLE_OFFSET = 18;
const HALL_ROTATE_HANDLE_OFFSET = 34;
const HALL_HANDLE_HIT_RADIUS = 10;
const CANVAS_SCROLL_PADDING = 520;

function toImageUrl(imagePath) {
  if (!imagePath) {
    return "";
  }
  return IMAGE_BASE_URL
    ? `${IMAGE_BASE_URL.replace(/\/$/, "")}/${String(imagePath).replace(/^\//, "")}`
    : String(imagePath);
}

async function readJson(response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.message || `Request failed (${response.status})`);
  }
  return json;
}

function asFiniteNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function roundCoordinate(value) {
  return Math.round(asFiniteNumber(value, 0) * 1000) / 1000;
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

function inverseTransformPoint(transform, point) {
  const scale = normalizeScale(transform?.scale);
  const radians = degreesToRadians(transform?.rotation);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - asFiniteNumber(transform?.x, 0);
  const dy = point.y - asFiniteNumber(transform?.y, 0);
  return {
    x: ((dx * cos) + (dy * sin)) / scale,
    y: ((dy * cos) - (dx * sin)) / scale
  };
}

function inverseTransformVector(transform, vector) {
  return inverseTransformPoint({ ...transform, x: 0, y: 0 }, vector);
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

function topEdgeLabelAnchor(polygon, offset = 6) {
  if (!polygon || polygon.length < 2) {
    return { x: 0, y: 0 };
  }
  const start = polygon[0];
  const end = polygon[1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(0.0001, Math.hypot(dx, dy));
  return {
    x: (start.x + end.x) / 2 + (dy / length) * offset,
    y: (start.y + end.y) / 2 - (dx / length) * offset
  };
}

function offsetPointFromCenter(point, center, offset) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const length = Math.max(0.0001, Math.hypot(dx, dy));
  return { x: point.x + (dx / length) * offset, y: point.y + (dy / length) * offset };
}

function hallHandlePoints(hall, graph) {
  const polygon = graph.getWorldPolygon(hall.id, 12);
  const transform = graph.getWorldTransform(hall.id);
  if (polygon.length < 2) {
    return null;
  }
  const topEdgeStart = polygon[0];
  const topEdgeEnd = polygon[1];
  return {
    move: offsetPointFromCenter(topEdgeStart, transform, HALL_MOVE_HANDLE_OFFSET),
    rotate: topEdgeLabelAnchor([topEdgeStart, topEdgeEnd], HALL_ROTATE_HANDLE_OFFSET),
    rotateBase: topEdgeLabelAnchor([topEdgeStart, topEdgeEnd], 8),
    center: { x: transform.x, y: transform.y }
  };
}

function angleDegrees(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
}

function parsePositiveCoordinate(value) {
  if (String(value ?? "").trim() === "") {
    return null;
  }
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? roundCoordinate(next) : null;
}

function makeEntityId(prefix, page, index = "") {
  return `${prefix}-${page}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeBoothSuffix(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ALLOWED_BOOTH_SUFFIXES.includes(normalized) ? normalized : "";
}

function median(numbers) {
  if (!numbers.length) {
    return 0;
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function modeRounded(values) {
  const histogram = new Map();
  for (const value of values) {
    const key = Math.max(1, Math.round(value));
    histogram.set(key, (histogram.get(key) || 0) + 1);
  }
  let bestKey = 0;
  let bestCount = -1;
  for (const [key, count] of histogram.entries()) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  return bestKey;
}

function overlapLength(startA, endA, startB, endB) {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function pointInRect(point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

function rectanglesIntersect(a, b) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    if (((current.y > point.y) !== (previous.y > point.y))
      && point.x < ((previous.x - current.x) * (point.y - current.y)) / ((previous.y - current.y) || 1) + current.x) {
      inside = !inside;
    }
  }
  return inside;
}

function rectangleContains(outer, inner) {
  return outer.x <= inner.x
    && outer.y <= inner.y
    && outer.x + outer.w >= inner.x + inner.w
    && outer.y + outer.h >= inner.y + inner.h;
}

function unionFind(size) {
  const parent = Array.from({ length: size }, (_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) {
      root = parent[root];
    }
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left, right) => {
    const rootLeft = find(left);
    const rootRight = find(right);
    if (rootLeft !== rootRight) {
      parent[rootRight] = rootLeft;
    }
  };
  return { find, union };
}

function clusterCoordinateMap(values, tolerance) {
  const map = new Map();
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const clusters = [];
  for (const item of sorted) {
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(item.value - last.mean) > tolerance) {
      clusters.push({ members: [item], sum: item.value, count: 1, mean: item.value });
      continue;
    }
    last.members.push(item);
    last.sum += item.value;
    last.count += 1;
    last.mean = last.sum / last.count;
  }
  for (const cluster of clusters) {
    const snapped = Math.round(cluster.mean);
    for (const member of cluster.members) {
      map.set(member.index, snapped);
    }
  }
  return map;
}

function collectNearestDiffsByAxis(booths, axis, groupBin, maxPitch) {
  const groups = new Map();
  for (const booth of booths) {
    const primary = axis === "x" ? booth.x : booth.y;
    const secondary = axis === "x" ? booth.y : booth.x;
    const key = Math.round(secondary / Math.max(groupBin, 1));
    const list = groups.get(key) || [];
    list.push(primary);
    groups.set(key, list);
  }
  const diffs = [];
  for (const values of groups.values()) {
    values.sort((a, b) => a - b);
    for (let index = 1; index < values.length; index += 1) {
      const diff = values[index] - values[index - 1];
      if (diff > 0 && diff <= maxPitch) {
        diffs.push(diff);
      }
    }
  }
  return diffs;
}

function buildRoundedHistogram(values) {
  return Object.fromEntries([...values.reduce((histogram, value) => {
    const key = String(Math.round(value));
    histogram.set(key, (histogram.get(key) || 0) + 1);
    return histogram;
  }, new Map()).entries()].sort((left, right) => Number(left[0]) - Number(right[0])));
}

function inferBoothSize(booths, options = {}) {
  const sizeOffset = asFiniteNumber(options.sizeOffset, 0);
  const explicitWidth = parsePositiveCoordinate(options.explicitWidth);
  const explicitHeight = parsePositiveCoordinate(options.explicitHeight);
  const widths = booths.map((booth) => booth.w).filter((value) => Number.isFinite(value) && value > 0);
  const heights = booths.map((booth) => booth.h).filter((value) => Number.isFinite(value) && value > 0);
  const medianWidth = median(widths) || 1;
  const medianHeight = median(heights) || 1;
  const xDiffs = collectNearestDiffsByAxis(booths, "x", Math.max(2, Math.round(medianHeight * 0.6)), Math.max(40, Math.round(medianWidth * 4)));
  const yDiffs = collectNearestDiffsByAxis(booths, "y", Math.max(2, Math.round(medianWidth * 0.6)), Math.max(40, Math.round(medianHeight * 4)));
  console.info("[MapEditor] adjacent booth distance histogram", {
    x: buildRoundedHistogram(xDiffs),
    y: buildRoundedHistogram(yDiffs)
  });
  const pitchX = modeRounded(xDiffs);
  const pitchY = modeRounded(yDiffs);
  const baseWidth = Math.max(Math.round(medianWidth), pitchX || Math.round(medianWidth));
  const baseHeight = Math.max(Math.round(medianHeight), pitchY || Math.round(medianHeight));
  return {
    targetWidth: explicitWidth ?? Math.max(1, roundCoordinate(baseWidth + sizeOffset)),
    targetHeight: explicitHeight ?? Math.max(1, roundCoordinate(baseHeight + sizeOffset))
  };
}

function computeOrientation(rect) {
  return rect && rect.w >= rect.h ? "horizontal" : "vertical";
}

function rectFromWorldRects(rects) {
  const validRects = rects.filter(Boolean);
  if (!validRects.length) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  const minX = Math.min(...validRects.map((rect) => rect.x));
  const minY = Math.min(...validRects.map((rect) => rect.y));
  const maxX = Math.max(...validRects.map((rect) => rect.x + rect.w));
  const maxY = Math.max(...validRects.map((rect) => rect.y + rect.h));
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function expandWorldRect(rect, amount) {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    w: rect.w + amount * 2,
    h: rect.h + amount * 2
  };
}

function unionWorldRects(rects) {
  return rectFromWorldRects(rects.filter(Boolean));
}

function worldRectFromPage(page, graph, canvasSize) {
  const baseRect = { x: 0, y: 0, w: Math.max(1, canvasSize.naturalWidth || 1), h: Math.max(1, canvasSize.naturalHeight || 1) };
  if (!page || !graph) {
    return baseRect;
  }
  const entityRects = flattenEntities(page.entities || {}).map((entity) => graph.getWorldRect(entity.id)).filter(Boolean);
  return unionWorldRects([baseRect, ...entityRects]);
}

function normalizeBoothEntity(entity) {
  return {
    id: String(entity?.id || ""),
    type: "booth",
    parentId: String(entity?.parentId || ""),
    x: roundCoordinate(entity?.x),
    y: roundCoordinate(entity?.y),
    w: Math.max(1, Math.round(asFiniteNumber(entity?.w, 1))),
    h: Math.max(1, Math.round(asFiniteNumber(entity?.h, 1))),
    page: Math.max(1, Math.round(asFiniteNumber(entity?.page, 1))),
    boothNumber: String(entity?.boothNumber ?? entity?.booth_number ?? ""),
    boothSuffix: normalizeBoothSuffix(entity?.boothSuffix ?? entity?.booth_suffix ?? ""),
    splitIndex: Math.max(0, Math.round(asFiniteNumber(entity?.splitIndex ?? entity?.split_index, 0))),
    excluded: Boolean(entity?.excluded)
  };
}

function normalizeGroupEntity(entity) {
  return {
    id: String(entity?.id || ""),
    type: "group",
    parentId: String(entity?.parentId || ""),
    x: roundCoordinate(entity?.x),
    y: roundCoordinate(entity?.y)
  };
}

function normalizeIslandEntity(entity) {
  return {
    id: String(entity?.id || ""),
    type: "island",
    parentId: String(entity?.parentId || ""),
    x: roundCoordinate(entity?.x),
    y: roundCoordinate(entity?.y),
    raw: String(entity?.raw ?? entity?.islandRaw ?? entity?.islandLabelRaw ?? "")
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
    scale: normalizeScale(entity?.scale),
    backgroundImagePath: String(entity?.backgroundImagePath || entity?.background_image_path || ""),
    backgroundOffsetX: roundCoordinate(entity?.backgroundOffsetX ?? entity?.background_offset_x),
    backgroundOffsetY: roundCoordinate(entity?.backgroundOffsetY ?? entity?.background_offset_y),
    trim: Math.max(0, Math.round(asFiniteNumber(entity?.trim, 0)))
  };
}

function normalizeEntities(page) {
  if (page?.entities && typeof page.entities === "object") {
    return {
      booths: Array.isArray(page.entities.booths) ? page.entities.booths.map(normalizeBoothEntity) : [],
      groups: Array.isArray(page.entities.groups) ? page.entities.groups.map(normalizeGroupEntity) : [],
      islands: Array.isArray(page.entities.islands) ? page.entities.islands.map(normalizeIslandEntity) : [],
      halls: Array.isArray(page.entities.halls) ? page.entities.halls.map(normalizeHallEntity) : []
    };
  }
  const booths = Array.isArray(page?.booths) ? page.booths : [];
  return {
    booths: booths.map((booth, index) => {
      const editor = booth?.editor && typeof booth.editor === "object" ? booth.editor : {};
      const box = booth?.bbox || {};
      return normalizeBoothEntity({
        id: editor.__id || `B${page?.page || 1}-${index}`,
        parentId: "",
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        page: booth?.page || page?.page || 1,
        boothNumber: booth?.boothNumber ?? booth?.booth_number ?? "",
        boothSuffix: booth?.boothSuffix ?? booth?.booth_suffix ?? "",
        splitIndex: booth?.splitIndex ?? booth?.split_index ?? 0,
        excluded: Boolean(editor.__sizeExcluded || booth?.__sizeExcluded)
      });
    }),
    groups: [],
    islands: [],
    halls: []
  };
}

function normalizePage(page) {
  const entities = normalizeEntities(page);
  const boothCount = entities.booths.length;
  return {
    page: Math.max(1, Math.round(asFiniteNumber(page?.page, 1))),
    image: String(page?.image || `page-${page?.page || 1}.png`),
    renderedImagePath: String(page?.renderedImagePath || ""),
    renderedImageWidth: Math.max(0, Math.round(asFiniteNumber(page?.renderedImageWidth ?? page?.rendered_image_width, 0))),
    renderedImageHeight: Math.max(0, Math.round(asFiniteNumber(page?.renderedImageHeight ?? page?.rendered_image_height, 0))),
    debugImagePath: String(page?.debugImagePath || ""),
    boothRectangleCount: Math.max(boothCount, Math.round(asFiniteNumber(page?.boothRectangleCount, boothCount))),
    boothCount,
    entities
  };
}

function createBlankPage(pageNumber) {
  return normalizePage({
    page: pageNumber,
    image: `page-${pageNumber}.png`,
    renderedImagePath: "",
    renderedImageWidth: 1,
    renderedImageHeight: 1,
    debugImagePath: "",
    boothRectangleCount: 0,
    entities: { booths: [], groups: [], islands: [], halls: [] }
  });
}

function flattenEntities(entities) {
  return [
    ...(entities?.booths || []),
    ...(entities?.groups || []),
    ...(entities?.islands || []),
    ...(entities?.halls || [])
  ].filter((entity) => entity?.id);
}

function buildEntityGraph(page) {
  const byId = new Map(flattenEntities(page?.entities || {}).map((entity) => [entity.id, entity]));
  const childrenByParent = new Map();
  for (const entity of byId.values()) {
    if (!entity.parentId || !byId.has(entity.parentId)) {
      continue;
    }
    const list = childrenByParent.get(entity.parentId) || [];
    list.push(entity.id);
    childrenByParent.set(entity.parentId, list);
  }

  const worldTransformCache = new Map();
  const getLocalTransform = (entity) => ({
    x: asFiniteNumber(entity?.x, 0),
    y: asFiniteNumber(entity?.y, 0),
    rotation: entity?.type === "hall" ? asFiniteNumber(entity.rotation, 0) : 0,
    scale: entity?.type === "hall" ? normalizeScale(entity.scale) : 1
  });
  const getWorldTransform = (entityId) => {
    if (worldTransformCache.has(entityId)) {
      return worldTransformCache.get(entityId);
    }
    const entity = byId.get(entityId);
    if (!entity) {
      return { x: 0, y: 0, rotation: 0 };
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

  const worldPolygonCache = new Map();
  const buildWorldPolygon = (entityId, localPad = 0) => {
    const localRect = getLocalRect(entityId);
    const transform = getWorldTransform(entityId);
    return localRect ? rectCorners(expandRect(localRect, localPad)).map((point) => transformPoint(transform, point)) : [];
  };
  const getWorldPolygon = (entityId, pad = 0) => {
    if (!pad && worldPolygonCache.has(entityId)) {
      return worldPolygonCache.get(entityId);
    }
    const transform = getWorldTransform(entityId);
    const localPad = pad / Math.max(0.0001, Math.abs(normalizeScale(transform.scale)));
    const polygon = buildWorldPolygon(entityId, localPad);
    if (!pad) {
      worldPolygonCache.set(entityId, polygon);
    }
    return polygon;
  };
  const getWorldPolygonWithLocalPad = (entityId, localPad = 0) => buildWorldPolygon(entityId, localPad);

  const worldRectCache = new Map();
  const getWorldRect = (entityId) => {
    if (worldRectCache.has(entityId)) {
      return worldRectCache.get(entityId);
    }
    const entity = byId.get(entityId);
    if (!entity) {
      return null;
    }
    const rect = rectFromPoints(getWorldPolygon(entityId));
    worldRectCache.set(entityId, rect);
    return rect;
  };

  const pointToParentLocal = (parentId, point) => parentId && byId.has(parentId)
    ? inverseTransformPoint(getWorldTransform(parentId), point)
    : point;

  const vectorToParentLocal = (parentId, vector) => parentId && byId.has(parentId)
    ? inverseTransformVector(getWorldTransform(parentId), vector)
    : vector;

  const ancestorsOf = (entityId) => {
    const ancestors = [];
    let current = byId.get(entityId);
    while (current?.parentId && byId.has(current.parentId)) {
      const parent = byId.get(current.parentId);
      ancestors.push(parent);
      current = parent;
    }
    return ancestors;
  };

  const descendantsOf = (entityId) => {
    const result = [];
    const visit = (parentId) => {
      for (const childId of childrenByParent.get(parentId) || []) {
        const child = byId.get(childId);
        if (child) {
          result.push(child);
          visit(child.id);
        }
      }
    };
    visit(entityId);
    return result;
  };

  const boothDescendantsOf = (entityId) => descendantsOf(entityId).filter((entity) => entity.type === "booth");
  return { byId, childrenByParent, getWorldTransform, getWorldRect, getWorldPolygon, getWorldPolygonWithLocalPad, pointToParentLocal, vectorToParentLocal, ancestorsOf, descendantsOf, boothDescendantsOf };
}

function createPageWithEntities(page, updater) {
  const entities = updater(page.entities);
  return { ...page, entities, boothCount: entities.booths.length };
}

function updateEntities(entities, ids, updater) {
  const idSet = new Set(ids);
  const updateList = (list) => list.map((entity) => (idSet.has(entity.id) ? updater(entity) : entity));
  return {
    booths: updateList(entities.booths || []),
    groups: updateList(entities.groups || []),
    islands: updateList(entities.islands || []),
    halls: updateList(entities.halls || [])
  };
}

function cloneEntitiesForPage(sourcePage, targetPageNumber) {
  const sourceEntities = sourcePage?.entities || {};
  const orderedEntities = [
    ...(sourceEntities.halls || []),
    ...(sourceEntities.islands || []),
    ...(sourceEntities.groups || []),
    ...(sourceEntities.booths || [])
  ];
  const idMap = new Map(orderedEntities.map((entity, index) => [entity.id, makeEntityId(entity.type || "entity", targetPageNumber, `import-${index}`)]));
  const cloneEntity = (entity) => ({
    ...entity,
    id: idMap.get(entity.id),
    parentId: idMap.get(entity.parentId) || "",
    page: entity.type === "booth" ? targetPageNumber : entity.page
  });
  return {
    booths: (sourceEntities.booths || []).map(cloneEntity),
    groups: (sourceEntities.groups || []).map(cloneEntity),
    islands: (sourceEntities.islands || []).map(cloneEntity),
    halls: (sourceEntities.halls || []).map(cloneEntity)
  };
}

function entityLabel(entity) {
  if (!entity) {
    return "None";
  }
  if (entity.type === "booth") {
    return `${entity.boothNumber || ""}${entity.boothSuffix || ""}`.trim() || entity.id;
  }
  if (entity.type === "hall") {
    return `Hall ${entity.id}`;
  }
  if (entity.type === "island") {
    return `Island ${entity.raw || entity.id}`;
  }
  return `Group ${entity.id}`;
}

function sortIslandsForSequence(islands, graph, direction) {
  return [...islands].sort((left, right) => {
    const leftRect = graph.getWorldRect(left.id);
    const rightRect = graph.getWorldRect(right.id);
    if (!leftRect || !rightRect) {
      return left.id.localeCompare(right.id);
    }
    if (direction === "right-to-left") {
      return rightRect.x !== leftRect.x ? rightRect.x - leftRect.x : leftRect.y - rightRect.y;
    }
    if (direction === "top-to-bottom") {
      return leftRect.y !== rightRect.y ? leftRect.y - rightRect.y : leftRect.x - rightRect.x;
    }
    if (direction === "bottom-to-top") {
      return rightRect.y !== leftRect.y ? rightRect.y - leftRect.y : leftRect.x - rightRect.x;
    }
    return leftRect.x !== rightRect.x ? leftRect.x - rightRect.x : leftRect.y - rightRect.y;
  });
}

function isKatakanaChar(value) {
  const codePoint = String(value || "").codePointAt(0);
  return Number.isFinite(codePoint) && codePoint >= 0x30a1 && codePoint <= 0x30ff;
}

function katakanaToHiragana(value) {
  return String(value || "").replace(/[\u30a1-\u30f6]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60));
}

function hiraganaToKatakana(value) {
  return String(value || "").replace(/[\u3041-\u3096]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 0x60));
}

function numberToAlphabetLabel(number, uppercase) {
  let value = number;
  let label = "";
  const baseCode = uppercase ? 65 : 97;
  while (value >= 0) {
    label = String.fromCharCode(baseCode + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  }
  return label;
}

function buildIslandSequenceLabels(startSymbol, count) {
  const normalizedStart = String(startSymbol || "あ").trim() || "あ";
  const useKatakana = isKatakanaChar(normalizedStart);
  const lookupStart = useKatakana ? katakanaToHiragana(normalizedStart) : normalizedStart;
  const startIndex = HIRAGANA_SEQUENCE.indexOf(lookupStart);
  if (startIndex < 0) {
    if (/^[A-Za-z]$/.test(normalizedStart)) {
      const uppercase = normalizedStart === normalizedStart.toUpperCase();
      const startOffset = normalizedStart.toUpperCase().charCodeAt(0) - 65;
      return Array.from({ length: count }, (_, index) => numberToAlphabetLabel(startOffset + index, uppercase));
    }
    return Array.from({ length: count }, (_, index) => `${normalizedStart}${index === 0 ? "" : index + 1}`);
  }
  return Array.from({ length: count }, (_, index) => {
    const kana = HIRAGANA_SEQUENCE[(startIndex + index) % HIRAGANA_SEQUENCE.length];
    return useKatakana ? hiraganaToKatakana(kana) : kana;
  });
}

function buildSerpentineBoothOrder(booths, graph, startCorner) {
  const entries = booths.map((booth) => {
    const rect = graph.getWorldRect(booth.id);
    return { booth, rect, centerX: rect.x + rect.w / 2, centerY: rect.y + rect.h / 2 };
  });
  const boundary = rectFromWorldRects(entries.map((entry) => entry.rect));
  const isHorizontal = boundary.w >= boundary.h;
  const laneSizes = entries.map((entry) => (isHorizontal ? entry.rect.h : entry.rect.w));
  const laneTolerance = Math.max(4, Math.round(median(laneSizes) * 0.65));
  const minorKey = isHorizontal ? "centerY" : "centerX";
  const majorKey = isHorizontal ? "centerX" : "centerY";
  const sorted = entries.sort((left, right) => left[minorKey] - right[minorKey] || left[majorKey] - right[majorKey]);
  const lanes = [];
  for (const entry of sorted) {
    const last = lanes[lanes.length - 1];
    if (!last || Math.abs(entry[minorKey] - last.anchor) > laneTolerance) {
      lanes.push({ anchor: entry[minorKey], members: [entry] });
      continue;
    }
    last.members.push(entry);
    last.anchor = last.members.reduce((sum, item) => sum + item[minorKey], 0) / last.members.length;
  }
  const startsTop = String(startCorner || "top-left").startsWith("top");
  const startsLeft = String(startCorner || "top-left").endsWith("left");
  const majorAscending = isHorizontal ? startsLeft : startsTop;
  const minorAscending = isHorizontal ? startsTop : startsLeft;
  const orderedLanes = lanes.sort((left, right) => (minorAscending ? left.anchor - right.anchor : right.anchor - left.anchor));
  const ordered = [];
  orderedLanes.forEach((lane, laneIndex) => {
    const members = lane.members.sort((left, right) => left[majorKey] - right[majorKey]);
    const reverse = laneIndex % 2 === 0 ? !majorAscending : majorAscending;
    if (reverse) {
      members.reverse();
    }
    members.forEach((member) => ordered.push(member.booth));
  });
  return ordered;
}

function parseBoothNumberValue(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function parseStrictBoothNumber(value) {
  const normalized = String(value || "").trim();
  return /^\d+$/.test(normalized) ? Number(normalized) : null;
}

function oppositeAxis(axis) {
  return axis === "vertical" ? "horizontal" : "vertical";
}

function axisCenterKey(axis) {
  return axis === "vertical" ? "centerY" : "centerX";
}

function axisSizeKey(axis) {
  return axis === "vertical" ? "h" : "w";
}

function clusterEntriesByCoordinate(entries, key, tolerance) {
  const clusters = [];
  const sorted = [...entries].sort((left, right) => left[key] - right[key]);
  for (const entry of sorted) {
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(entry[key] - last.anchor) > tolerance) {
      clusters.push({ anchor: entry[key], members: [entry] });
      continue;
    }
    last.members.push(entry);
    last.anchor = last.members.reduce((sum, member) => sum + member[key], 0) / last.members.length;
  }
  return clusters;
}

function findAdjacentNumbersAlongAxis(entry, entries, axis) {
  const majorKey = axisCenterKey(axis);
  const minorAxis = oppositeAxis(axis);
  const minorKey = axisCenterKey(minorAxis);
  const minorSizeKey = axisSizeKey(minorAxis);
  const tolerance = Math.max(4, entry.rect[minorSizeKey] * 0.7);
  const candidates = entries
    .filter((candidate) => candidate !== entry && Math.abs(candidate[minorKey] - entry[minorKey]) <= tolerance)
    .map((candidate) => ({
      ...candidate,
      number: parseBoothNumberValue(candidate.booth.boothNumber),
      side: candidate[majorKey] < entry[majorKey] ? "before" : "after",
      distance: Math.abs(candidate[majorKey] - entry[majorKey])
    }))
    .filter((candidate) => Number.isFinite(candidate.number) && candidate.distance > 0)
    .sort((left, right) => left.distance - right.distance);
  return {
    before: candidates.find((candidate) => candidate.side === "before") || null,
    after: candidates.find((candidate) => candidate.side === "after") || null
  };
}

function suffixForAdjacentNumber(ownNumber, adjacent) {
  if (!adjacent || !Number.isFinite(ownNumber) || !Number.isFinite(adjacent.number)) {
    return "";
  }
  return adjacent.number < ownNumber ? "a" : "b";
}

function fillMissingSideSuffixes(sideSuffixes) {
  const before = sideSuffixes.before || (sideSuffixes.after === "a" ? "b" : "a");
  const after = sideSuffixes.after || (before === "a" ? "b" : "a");
  return { before, after };
}

function inferSplitSuffixes(entry, entries, islandAxis) {
  const ownNumber = parseBoothNumberValue(entry.booth.boothNumber);
  const adjacentBySide = findAdjacentNumbersAlongAxis(entry, entries, islandAxis);
  return fillMissingSideSuffixes({
    before: suffixForAdjacentNumber(ownNumber, adjacentBySide.before),
    after: suffixForAdjacentNumber(ownNumber, adjacentBySide.after)
  });
}

function rotateSplitSuffixes(suffixes, islandAxis, rotationDirection) {
  const shouldSwap = islandAxis === "vertical"
    ? rotationDirection === "clockwise"
    : rotationDirection === "counterclockwise";
  return shouldSwap
    ? { before: suffixes.after, after: suffixes.before }
    : suffixes;
}

function collectDoubleLaneGroupCornerRotations(groupEntries, islandAxis) {
  const rotations = new Map();
  if (groupEntries.length < 4) {
    return rotations;
  }
  const minorAxis = oppositeAxis(islandAxis);
  const majorKey = axisCenterKey(islandAxis);
  const minorKey = axisCenterKey(minorAxis);
  const majorSizeKey = axisSizeKey(islandAxis);
  const minorSizeKey = axisSizeKey(minorAxis);
  const minorTolerance = Math.max(4, median(groupEntries.map((entry) => entry.rect[minorSizeKey])) * 0.7);
  const majorTolerance = Math.max(4, median(groupEntries.map((entry) => entry.rect[majorSizeKey])) * 0.7);
  const lanes = clusterEntriesByCoordinate(groupEntries, minorKey, minorTolerance);
  if (lanes.length !== 2) {
    return rotations;
  }
  const majorClusters = clusterEntriesByCoordinate(groupEntries, majorKey, majorTolerance);
  if (majorClusters.length < 2) {
    return rotations;
  }
  const groupBoundary = rectFromWorldRects(groupEntries.map((entry) => entry.rect));
  const centerX = groupBoundary.x + groupBoundary.w / 2;
  const centerY = groupBoundary.y + groupBoundary.h / 2;
  const usedIds = new Set();
  for (const majorCluster of [majorClusters[0], majorClusters[majorClusters.length - 1]]) {
    for (const lane of lanes) {
      const entry = majorCluster.members
        .filter((member) => lane.members.some((laneMember) => laneMember.booth.id === member.booth.id) && !usedIds.has(member.booth.id))
        .sort((left, right) => Math.abs(left[majorKey] - majorCluster.anchor) + Math.abs(left[minorKey] - lane.anchor)
          - Math.abs(right[majorKey] - majorCluster.anchor) - Math.abs(right[minorKey] - lane.anchor))[0];
      if (!entry) {
        continue;
      }
      usedIds.add(entry.booth.id);
      const isTopLeftOrBottomRight = (entry.centerX < centerX && entry.centerY < centerY) || (entry.centerX >= centerX && entry.centerY >= centerY);
      const rotationDirection = islandAxis === "vertical"
        ? (isTopLeftOrBottomRight ? "clockwise" : "counterclockwise")
        : (isTopLeftOrBottomRight ? "counterclockwise" : "clockwise");
      rotations.set(entry.booth.id, rotationDirection);
    }
  }
  return rotations;
}

function validateMapEditorPages(pages) {
  const violations = [];
  const sortedPages = [...(pages || [])].sort((left, right) => Number(left.page || 0) - Number(right.page || 0));
  if (sortedPages.length < 4) {
    violations.push(`Expected at least 4 pages, found ${sortedPages.length}.`);
  }

  sortedPages.slice(0, PAGE_ISLAND_RAW_SEQUENCES.length).forEach((page, pageIndex) => {
    const sequence = PAGE_ISLAND_RAW_SEQUENCES[pageIndex];
    const pageLabel = `Page ${page.page || pageIndex + 1}`;
    const graph = buildEntityGraph(page);
    const islands = Array.isArray(page.entities?.islands) ? page.entities.islands : [];
    const rawToIslands = new Map();
    const presentRawIndexes = new Set();

    if (!islands.length) {
      violations.push(`${pageLabel}: no islands found.`);
    }

    for (const island of islands) {
      const raw = String(island.raw || "").trim();
      if (!raw) {
        violations.push(`${pageLabel}: island ${island.id} has no raw code.`);
        continue;
      }
      const normalizedRaw = sequence.normalize ? sequence.normalize(raw) : raw;
      const rawIndex = sequence.values.indexOf(normalizedRaw);
      if (rawIndex < 0) {
        violations.push(`${pageLabel}: island ${island.id} raw "${raw}" is not in ${sequence.label} sequence from ${sequence.start}.`);
        continue;
      }
      presentRawIndexes.add(rawIndex);
      const list = rawToIslands.get(normalizedRaw) || [];
      list.push(island);
      rawToIslands.set(normalizedRaw, list);
    }

    if (presentRawIndexes.size) {
      const maxRawIndex = Math.max(...presentRawIndexes);
      for (let index = 0; index <= maxRawIndex; index += 1) {
        if (!presentRawIndexes.has(index)) {
          violations.push(`${pageLabel}: missing island raw "${sequence.values[index]}" before later assigned raw.`);
        }
      }
    }

    for (const [raw, rawIslands] of rawToIslands.entries()) {
      const boothById = new Map();
      for (const island of rawIslands) {
        const islandBooths = graph.boothDescendantsOf(island.id);
        const islandNumberCounts = new Map();
        for (const booth of islandBooths) {
          const boothNumber = parseStrictBoothNumber(booth.boothNumber);
          if (Number.isFinite(boothNumber) && boothNumber >= 1) {
            islandNumberCounts.set(boothNumber, (islandNumberCounts.get(boothNumber) || 0) + 1);
          }
          boothById.set(booth.id, booth);
        }
        for (const [boothNumber, count] of islandNumberCounts.entries()) {
          if (count !== 2) {
            violations.push(`${pageLabel} island ${island.id} raw "${raw}" number ${boothNumber}: expected exactly 2 booths inside this island, found ${count}.`);
          }
        }
      }
      const booths = [...boothById.values()];
      if (!booths.length) {
        violations.push(`${pageLabel} island raw "${raw}": no booths found.`);
        continue;
      }

      const suffixesByNumber = new Map();
      for (const booth of booths) {
        const boothNumber = parseStrictBoothNumber(booth.boothNumber);
        if (!Number.isFinite(boothNumber) || boothNumber < 1) {
          violations.push(`${pageLabel} island raw "${raw}": booth ${booth.id} has invalid number "${booth.boothNumber || ""}".`);
          continue;
        }
        const suffix = normalizeBoothSuffix(booth.boothSuffix);
        if (suffix !== "a" && suffix !== "b") {
          violations.push(`${pageLabel} island raw "${raw}" number ${boothNumber}: booth ${booth.id} suffix must be a or b.`);
          continue;
        }
        const suffixes = suffixesByNumber.get(boothNumber) || [];
        suffixes.push(suffix);
        suffixesByNumber.set(boothNumber, suffixes);
      }

      if (!suffixesByNumber.size) {
        continue;
      }
      for (const [number, suffixes] of suffixesByNumber.entries()) {
        const aCount = suffixes.filter((suffix) => suffix === "a").length;
        const bCount = suffixes.filter((suffix) => suffix === "b").length;
        if (aCount !== 1 || bCount !== 1 || suffixes.length !== 2) {
          violations.push(`${pageLabel} island raw "${raw}" number ${number}: expected exactly one a and one b, found ${suffixes.length ? suffixes.join(", ") : "none"}.`);
        }
      }
    }
  });

  return violations;
}

function buildGroupsFromBooths(page, boothSizeOptions = {}) {
  const graph = buildEntityGraph(page);
  const worldBooths = (page.entities.booths || []).map((booth) => ({ ...booth, ...graph.getWorldRect(booth.id) }));
  if (!worldBooths.length) {
    return page;
  }
  const inferred = inferBoothSize(worldBooths, boothSizeOptions);
  const thresholdW = Math.max(2, Math.round(inferred.targetWidth * 0.35));
  const thresholdH = Math.max(2, Math.round(inferred.targetHeight * 0.35));
  const alignToleranceX = Math.max(2, Math.round(inferred.targetWidth * 0.25));
  const alignToleranceY = Math.max(2, Math.round(inferred.targetHeight * 0.25));
  const touchTolerance = Math.max(1, Math.round(Math.min(inferred.targetWidth, inferred.targetHeight) * 0.15));
  const fixed = worldBooths.map((booth) => {
    const outlier = Math.abs(booth.w - inferred.targetWidth) > thresholdW || Math.abs(booth.h - inferred.targetHeight) > thresholdH;
    if (outlier) {
      return { ...booth, excluded: true };
    }
    const centerX = booth.x + booth.w / 2;
    const centerY = booth.y + booth.h / 2;
    return {
      ...booth,
      excluded: false,
      x: Math.round(centerX - inferred.targetWidth / 2),
      y: Math.round(centerY - inferred.targetHeight / 2),
      w: inferred.targetWidth,
      h: inferred.targetHeight
    };
  });
  const snapXMap = clusterCoordinateMap(fixed.map((booth) => booth.x + booth.w / 2), alignToleranceX);
  const snapYMap = clusterCoordinateMap(fixed.map((booth) => booth.y + booth.h / 2), alignToleranceY);
  fixed.forEach((booth, index) => {
    booth.x = Math.round((snapXMap.get(index) ?? booth.x + booth.w / 2) - booth.w / 2);
    booth.y = Math.round((snapYMap.get(index) ?? booth.y + booth.h / 2) - booth.h / 2);
  });

  const { find, union } = unionFind(fixed.length);
  for (let i = 0; i < fixed.length; i += 1) {
    for (let j = i + 1; j < fixed.length; j += 1) {
      const a = fixed[i];
      const b = fixed[j];
      const verticalOverlap = overlapLength(a.y, a.y + a.h, b.y, b.y + b.h) / Math.max(1, Math.min(a.h, b.h));
      const horizontalOverlap = overlapLength(a.x, a.x + a.w, b.x, b.x + b.w) / Math.max(1, Math.min(a.w, b.w));
      const horizontalGap = a.x <= b.x ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
      const verticalGap = a.y <= b.y ? b.y - (a.y + a.h) : a.y - (b.y + b.h);
      const shouldGroup = (verticalOverlap >= 0.55 && Math.abs(horizontalGap) <= touchTolerance) || (horizontalOverlap >= 0.55 && Math.abs(verticalGap) <= touchTolerance);
      if (!shouldGroup) {
        continue;
      }
      if (verticalOverlap >= 0.55 && Math.abs(horizontalGap) <= touchTolerance) {
        if (a.x <= b.x) {
          b.x = a.x + a.w;
        } else {
          a.x = b.x + b.w;
        }
      }
      if (horizontalOverlap >= 0.55 && Math.abs(verticalGap) <= touchTolerance) {
        if (a.y <= b.y) {
          b.y = a.y + a.h;
        } else {
          a.y = b.y + b.h;
        }
      }
      union(i, j);
    }
  }

  const groupsByRoot = new Map();
  fixed.forEach((booth, index) => {
    const root = find(index);
    const list = groupsByRoot.get(root) || [];
    list.push(booth);
    groupsByRoot.set(root, list);
  });
  const nextGroups = [];
  const groupByBoothId = new Map();
  let groupSequence = 1;
  for (const groupBooths of groupsByRoot.values()) {
    if (groupBooths.length <= 1) {
      continue;
    }
    const boundary = rectFromWorldRects(groupBooths);
    const group = { id: `G${groupSequence}`, type: "group", parentId: "", x: Math.round(boundary.x), y: Math.round(boundary.y) };
    groupSequence += 1;
    nextGroups.push(group);
    groupBooths.forEach((booth) => groupByBoothId.set(booth.id, group));
  }
  const fixedById = new Map(fixed.map((booth) => [booth.id, booth]));
  const nextBooths = page.entities.booths.map((booth) => {
    const fixedBooth = fixedById.get(booth.id);
    const group = groupByBoothId.get(booth.id);
    return {
      ...booth,
      parentId: group?.id || "",
      x: Math.round(fixedBooth.x - (group?.x || 0)),
      y: Math.round(fixedBooth.y - (group?.y || 0)),
      w: fixedBooth.w,
      h: fixedBooth.h,
      excluded: fixedBooth.excluded
    };
  });
  return { ...page, entities: { booths: nextBooths, groups: nextGroups, islands: [], halls: [] } };
}

function buildIslandsFromGroups(page) {
  const graph = buildEntityGraph(page);
  const groups = page.entities.groups.map((group) => ({ ...group, boundary: graph.getWorldRect(group.id) })).filter((group) => group.boundary);
  if (!groups.length) {
    return page;
  }
  const { find, union } = unionFind(groups.length);
  for (let i = 0; i < groups.length; i += 1) {
    for (let j = i + 1; j < groups.length; j += 1) {
      const a = groups[i].boundary;
      const b = groups[j].boundary;
      const orientation = computeOrientation(a);
      if (orientation !== computeOrientation(b)) {
        continue;
      }
      const horizontalOverlap = overlapLength(a.x, a.x + a.w, b.x, b.x + b.w);
      const verticalOverlap = overlapLength(a.y, a.y + a.h, b.y, b.y + b.h);
      const sameHorizontalBand = verticalOverlap / Math.max(1, Math.min(a.h, b.h)) >= 0.3 || Math.abs((a.y + a.h / 2) - (b.y + b.h / 2)) <= Math.max(a.h, b.h);
      const sameVerticalBand = horizontalOverlap / Math.max(1, Math.min(a.w, b.w)) >= 0.3 || Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)) <= Math.max(a.w, b.w);
      const horizontalGap = a.x <= b.x ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
      const verticalGap = a.y <= b.y ? b.y - (a.y + a.h) : a.y - (b.y + b.h);
      const shouldMerge = orientation === "horizontal"
        ? sameHorizontalBand && Math.abs(horizontalGap) <= Math.max(60, Math.round((a.w + b.w) * 0.15))
        : sameVerticalBand && Math.abs(verticalGap) <= Math.max(60, Math.round((a.h + b.h) * 0.15));
      if (shouldMerge) {
        union(i, j);
      }
    }
  }

  const islandGroupsByRoot = new Map();
  groups.forEach((group, index) => {
    const root = find(index);
    const list = islandGroupsByRoot.get(root) || [];
    list.push(group);
    islandGroupsByRoot.set(root, list);
  });
  const nextIslands = [];
  const islandByGroupId = new Map();
  let islandSequence = 1;
  for (const islandGroups of islandGroupsByRoot.values()) {
    const boundary = rectFromWorldRects(islandGroups.map((group) => group.boundary));
    const island = { id: `IS${islandSequence}`, type: "island", parentId: "", x: Math.round(boundary.x), y: Math.round(boundary.y), raw: String(islandSequence) };
    islandSequence += 1;
    nextIslands.push(island);
    islandGroups.forEach((group) => islandByGroupId.set(group.id, island));
  }
  const nextGroups = page.entities.groups.map((group) => {
    const island = islandByGroupId.get(group.id);
    const worldRect = graph.getWorldRect(group.id);
    return island
      ? { ...group, parentId: island.id, x: Math.round(worldRect.x - island.x), y: Math.round(worldRect.y - island.y) }
      : { ...group, parentId: "" };
  });
  return { ...page, entities: { ...page.entities, groups: nextGroups, islands: nextIslands, halls: [] } };
}

export function MapEditorPage() {
  const viewportRef = useRef(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const marqueeRef = useRef(null);
  const moveUndoStackRef = useRef([]);
  const activeMoveUndoGroupRef = useRef(null);
  const lastCanvasPointRef = useRef(null);
  const zoomAnchorRef = useRef(null);
  const viewportFrameRef = useRef(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snapshotMessage, setSnapshotMessage] = useState("");
  const [snapshotError, setSnapshotError] = useState("");
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);
  const [isTransferringSnapshot, setIsTransferringSnapshot] = useState(false);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false);
  const [loadedSnapshotId, setLoadedSnapshotId] = useState("");
  const [summary, setSummary] = useState(null);
  const [pages, setPages] = useState([]);
  const [selectedPageNumber, setSelectedPageNumber] = useState("");
  const [importSourcePageNumber, setImportSourcePageNumber] = useState("");
  const [isDeletePageDialogOpen, setIsDeletePageDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [imageSize, setImageSize] = useState({ naturalWidth: 1, naturalHeight: 1 });
  const [marquee, setMarquee] = useState(null);
  const [showMapLabels, setShowMapLabels] = useState(true);
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const [dragTick, setDragTick] = useState(0);
  const [viewportMetrics, setViewportMetrics] = useState({ scrollLeft: 0, scrollTop: 0, clientWidth: 1, clientHeight: 1 });
  const [canvasWorldRect, setCanvasWorldRect] = useState(() => expandWorldRect({ x: 0, y: 0, w: 1, h: 1 }, CANVAS_SCROLL_PADDING));
  const [islandSequenceDirection, setIslandSequenceDirection] = useState("left-to-right");
  const [islandSequenceStart, setIslandSequenceStart] = useState("あ");
  const [islandNumberingCorner, setIslandNumberingCorner] = useState("top-left");
  const [islandNumberingStart, setIslandNumberingStart] = useState("1");
  const [islandNumberingPairMode, setIslandNumberingPairMode] = useState(false);
  const [fixMapBoothSizeWidth, setFixMapBoothSizeWidth] = useState("");
  const [fixMapBoothSizeHeight, setFixMapBoothSizeHeight] = useState("");
  const [fixMapBoothSizeOffset, setFixMapBoothSizeOffset] = useState("0");
  const selectedIdsKey = useMemo(() => [...selectedIds].sort().join("|"), [selectedIds]);

  const MIN_ZOOM = 0.35;
  const MAX_ZOOM = 3.5;

  async function loadExtraction() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(MAP_EXTRACTION_API);
      const json = await readJson(response);
      const nextSummary = json.data || null;
      const nextPages = Array.isArray(nextSummary?.pages) ? nextSummary.pages.map(normalizePage) : [];
      setSummary(nextSummary);
      setPages(nextPages);
      setLoadedSnapshotId("");
      setSelectedPageNumber(nextPages.length ? String(nextPages[0].page) : "");
      setImportSourcePageNumber(nextPages.length ? String(nextPages[0].page) : "");
      setSelectedIds([]);
    } catch (loadError) {
      setError(loadError.message || "加载地图数据失败");
      setSummary(null);
      setPages([]);
      setSelectedPageNumber("");
      setImportSourcePageNumber("");
      setSelectedIds([]);
    } finally {
      setLoading(false);
    }
  }

  async function saveSnapshot() {
    if (!pages.length) {
      return;
    }
    setIsSavingSnapshot(true);
    setSnapshotMessage("");
    setSnapshotError("");
    try {
      const response = await fetch(MAP_EDITOR_SNAPSHOTS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages, summary })
      });
      const json = await readJson(response);
      setLoadedSnapshotId(String(json.data?.saveId || ""));
      setSnapshotMessage(`已保存快照 ${json.data?.saveId || ""}`.trim());
    } catch (requestError) {
      setSnapshotError(requestError.message || "保存快照失败");
    } finally {
      setIsSavingSnapshot(false);
    }
  }

  async function transferSnapshot() {
    if (!pages.length) {
      return;
    }
    setIsTransferringSnapshot(true);
    setSnapshotMessage("");
    setSnapshotError("");
    try {
      const response = await fetch(`${MAP_EDITOR_SNAPSHOTS_API}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages, summary })
      });
      const json = await readJson(response);
      setLoadedSnapshotId(String(json.data?.saveId || ""));
      setSnapshotMessage(`已转存到 ${json.data?.transfer?.targetPath || "storage/map"}`.trim());
    } catch (requestError) {
      setSnapshotError(requestError.message || "转存失败");
    } finally {
      setIsTransferringSnapshot(false);
    }
  }

  async function loadLatestSnapshot() {
    setIsLoadingSnapshot(true);
    setSnapshotMessage("");
    setSnapshotError("");
    try {
      const response = await fetch(`${MAP_EDITOR_SNAPSHOTS_API}/latest`);
      const json = await readJson(response);
      const snapshot = json.data || null;
      const nextPages = Array.isArray(snapshot?.pages) ? snapshot.pages.map(normalizePage) : [];
      const nextSelectedPageNumber = nextPages.some((page) => String(page.page) === String(selectedPageNumber))
        ? String(selectedPageNumber)
        : (nextPages.length ? String(nextPages[0].page) : "");
      setPages(nextPages);
      setSelectedPageNumber(nextSelectedPageNumber);
      setImportSourcePageNumber((current) => nextPages.some((page) => String(page.page) === String(current)) ? current : (nextPages.length ? String(nextPages[0].page) : ""));
      setSelectedIds([]);
      setSummary((current) => ({
        ...(current || {}),
        pageCount: Number(snapshot?.pageCount || nextPages.length || 0),
        totalBooths: Number(snapshot?.totalBooths || nextPages.reduce((sum, page) => sum + page.entities.booths.length, 0))
      }));
      setLoadedSnapshotId(String(snapshot?.saveId || ""));
      setSnapshotMessage(`已加载快照 ${snapshot?.saveId || ""}`.trim());
    } catch (requestError) {
      setSnapshotError(requestError.message || "加载最新快照失败");
    } finally {
      setIsLoadingSnapshot(false);
    }
  }

  async function loadPreviousSnapshot() {
    if (!loadedSnapshotId) {
      setSnapshotMessage("");
      setSnapshotError("请先加载一个已保存快照");
      return;
    }
    setIsLoadingSnapshot(true);
    setSnapshotMessage("");
    setSnapshotError("");
    try {
      const response = await fetch(`${MAP_EDITOR_SNAPSHOTS_API}/previous?saveId=${encodeURIComponent(loadedSnapshotId)}`);
      const json = await readJson(response);
      const snapshot = json.data || null;
      const nextPages = Array.isArray(snapshot?.pages) ? snapshot.pages.map(normalizePage) : [];
      const nextSelectedPageNumber = nextPages.some((page) => String(page.page) === String(selectedPageNumber))
        ? String(selectedPageNumber)
        : (nextPages.length ? String(nextPages[0].page) : "");
      setPages(nextPages);
      setSelectedPageNumber(nextSelectedPageNumber);
      setImportSourcePageNumber((current) => nextPages.some((page) => String(page.page) === String(current)) ? current : (nextPages.length ? String(nextPages[0].page) : ""));
      setSelectedIds([]);
      setSummary((current) => ({
        ...(current || {}),
        pageCount: Number(snapshot?.pageCount || nextPages.length || 0),
        totalBooths: Number(snapshot?.totalBooths || nextPages.reduce((sum, page) => sum + page.entities.booths.length, 0))
      }));
      setLoadedSnapshotId(String(snapshot?.saveId || ""));
      setSnapshotMessage(`已回退到快照 ${snapshot?.saveId || ""}`.trim());
    } catch (requestError) {
      setSnapshotError(requestError.message || "加载上一版快照失败");
    } finally {
      setIsLoadingSnapshot(false);
    }
  }

  function validateLoadedMap() {
    setSnapshotMessage("");
    setSnapshotError("");
    const violations = validateMapEditorPages(pages);
    if (!violations.length) {
      setSnapshotMessage("检查通过");
      return;
    }
    const visibleViolations = violations.slice(0, 30);
    const suffix = violations.length > visibleViolations.length ? `\n...还有 ${violations.length - visibleViolations.length} 条` : "";
    setSnapshotError(`检查失败（${violations.length} 条）：\n${visibleViolations.join("\n")}${suffix}`);
  }

  useEffect(() => {
    loadExtraction();
  }, []);

  useEffect(() => {
    activeMoveUndoGroupRef.current = null;
  }, [selectedPageNumber, selectedIdsKey]);

  const selectedPage = useMemo(
    () => pages.find((page) => String(page.page) === String(selectedPageNumber)) || null,
    [pages, selectedPageNumber]
  );
  const graph = useMemo(() => selectedPage ? buildEntityGraph(selectedPage) : null, [selectedPage]);
  const selectedEntities = useMemo(
    () => selectedIds.map((id) => graph?.byId.get(id)).filter(Boolean),
    [graph, selectedIds]
  );
  const selectedRect = useMemo(
    () => graph ? rectFromWorldRects(selectedIds.map((id) => graph.getWorldRect(id))) : null,
    [graph, selectedIds]
  );
  const selectedEntity = selectedEntities.length === 1 ? selectedEntities[0] : null;
  const selectedAreOnlyGroups = selectedEntities.length > 0 && selectedEntities.every((entity) => entity.type === "group");
  const selectedGroups = selectedEntities.filter((entity) => entity.type === "group");
  const selectedAreOnlyIslands = selectedEntities.length > 0 && selectedEntities.every((entity) => entity.type === "island");
  const selectedIslands = selectedEntities.filter((entity) => entity.type === "island");
  const canCreateIslandFromSelectedBooths = selectedEntities.length > 0 && selectedEntities.every((entity) => entity.type === "booth"
    && !graph?.ancestorsOf(entity.id).some((ancestor) => ancestor.type === "island"));
  const canMergeSelectedGroups = selectedAreOnlyGroups && selectedGroups.length >= 2;
  const canMergeSelectedIslands = selectedAreOnlyIslands && selectedIslands.length >= 2;
  const canCreateHallFromSelectedIslands = selectedAreOnlyIslands && selectedIslands.length > 0;
  const canSplitBoothsInSelectedIslands = selectedAreOnlyIslands && selectedIslands.length > 0 && selectedIslands
    .flatMap((island) => graph?.boothDescendantsOf(island.id) || [])
    .every((booth) => String(booth.boothNumber || "").trim());
  const canvasSize = {
    naturalWidth: Math.max(1, selectedPage?.renderedImageWidth || imageSize.naturalWidth || 1),
    naturalHeight: Math.max(1, selectedPage?.renderedImageHeight || imageSize.naturalHeight || 1)
  };

  useEffect(() => {
    const baseWorldRect = worldRectFromPage(selectedPage, graph, canvasSize);
    const nextWorldRect = expandWorldRect(baseWorldRect, CANVAS_SCROLL_PADDING);
    setCanvasWorldRect(nextWorldRect);
    const viewport = viewportRef.current;
    if (!viewport || !selectedPageNumber) {
      return;
    }
    viewport.scrollLeft = (0 - nextWorldRect.x) * zoom;
    viewport.scrollTop = (0 - nextWorldRect.y) * zoom;
    refreshViewportMetrics();
  }, [selectedPageNumber]);

  useEffect(() => {
    if (!selectedPage) {
      setCanvasWorldRect(expandWorldRect({ x: 0, y: 0, w: 1, h: 1 }, CANVAS_SCROLL_PADDING));
      return;
    }
    const baseWorldRect = worldRectFromPage(selectedPage, graph, canvasSize);
    const safeZoom = Math.max(zoom, 0.0001);
    const visibleRect = {
      x: canvasWorldRect.x + viewportMetrics.scrollLeft / safeZoom,
      y: canvasWorldRect.y + viewportMetrics.scrollTop / safeZoom,
      w: viewportMetrics.clientWidth / safeZoom,
      h: viewportMetrics.clientHeight / safeZoom
    };
    const requiredRect = expandWorldRect(unionWorldRects([baseWorldRect, visibleRect]), CANVAS_SCROLL_PADDING);
    const nextRect = {
      x: Math.min(canvasWorldRect.x, requiredRect.x),
      y: Math.min(canvasWorldRect.y, requiredRect.y),
      w: Math.max(canvasWorldRect.x + canvasWorldRect.w, requiredRect.x + requiredRect.w) - Math.min(canvasWorldRect.x, requiredRect.x),
      h: Math.max(canvasWorldRect.y + canvasWorldRect.h, requiredRect.y + requiredRect.h) - Math.min(canvasWorldRect.y, requiredRect.y)
    };
    const needsExpansion = nextRect.x < canvasWorldRect.x
      || nextRect.y < canvasWorldRect.y
      || nextRect.x + nextRect.w > canvasWorldRect.x + canvasWorldRect.w
      || nextRect.y + nextRect.h > canvasWorldRect.y + canvasWorldRect.h;
    if (!needsExpansion) {
      return;
    }
    const viewport = viewportRef.current;
    const deltaLeft = canvasWorldRect.x - nextRect.x;
    const deltaTop = canvasWorldRect.y - nextRect.y;
    setCanvasWorldRect(nextRect);
    if (viewport && (deltaLeft || deltaTop)) {
      viewport.scrollLeft += deltaLeft * zoom;
      viewport.scrollTop += deltaTop * zoom;
      scheduleViewportMetricsRefresh();
    }
  }, [selectedPage, graph, canvasSize.naturalWidth, canvasSize.naturalHeight, viewportMetrics, zoom, canvasWorldRect]);
  const addToTarget = useMemo(() => {
    if (!graph || selectedEntities.length !== 2) {
      return null;
    }
    const [first, second] = selectedEntities;
    const levelCandidates = [
      { parent: first, child: second },
      { parent: second, child: first }
    ];
    const levelTarget = levelCandidates.find((candidate) => ENTITY_PARENT_TYPE[candidate.child.type] === candidate.parent.type
      && candidate.child.parentId !== candidate.parent.id
      && !graph.ancestorsOf(candidate.parent.id).some((ancestor) => ancestor.id === candidate.child.id));
    if (levelTarget) {
      return levelTarget;
    }
    const firstRect = graph.getWorldRect(first.id);
    const secondRect = graph.getWorldRect(second.id);
    if (!firstRect || !secondRect) {
      return null;
    }
    const firstArea = firstRect.w * firstRect.h;
    const secondArea = secondRect.w * secondRect.h;
    const candidates = [
      { parent: first, child: second, parentRect: firstRect, childRect: secondRect, parentArea: firstArea, childArea: secondArea },
      { parent: second, child: first, parentRect: secondRect, childRect: firstRect, parentArea: secondArea, childArea: firstArea }
    ];
    return candidates.find((candidate) => candidate.parentArea > candidate.childArea
      && rectangleContains(candidate.parentRect, candidate.childRect)
      && candidate.child.parentId !== candidate.parent.id
      && !graph.ancestorsOf(candidate.parent.id).some((ancestor) => ancestor.id === candidate.child.id)) || null;
  }, [graph, selectedEntities]);

  const viewportRect = useMemo(() => {
    if (!selectedPage) {
      return null;
    }
    const overscan = 180;
    const safeZoom = Math.max(zoom, 0.0001);
    return {
      x: canvasWorldRect.x + viewportMetrics.scrollLeft / safeZoom - overscan / safeZoom,
      y: canvasWorldRect.y + viewportMetrics.scrollTop / safeZoom - overscan / safeZoom,
      w: viewportMetrics.clientWidth / safeZoom + (overscan * 2) / safeZoom,
      h: viewportMetrics.clientHeight / safeZoom + (overscan * 2) / safeZoom
    };
  }, [selectedPage, viewportMetrics, zoom, canvasWorldRect.x, canvasWorldRect.y]);

  function updateSelectedPage(updater) {
    setPages((currentPages) => currentPages.map((page) => (
      String(page.page) === String(selectedPageNumber) ? updater(page) : page
    )));
  }

  function createNewPage() {
    const existingPageNumbers = pages.map((page) => Math.round(asFiniteNumber(page.page, 0))).filter((pageNumber) => pageNumber > 0);
    const nextPageNumber = Math.max(0, ...existingPageNumbers) + 1;
    const nextPage = createBlankPage(nextPageNumber);
    setPages((currentPages) => [...currentPages, nextPage]);
    setSelectedPageNumber(String(nextPageNumber));
    setImportSourcePageNumber((current) => current || (pages.length ? String(pages[0].page) : String(nextPageNumber)));
    setSelectedIds([]);
    setSummary((current) => current ? { ...current, pageCount: Math.max(Number(current.pageCount || 0), pages.length + 1) } : current);
  }

  function requestDeleteCurrentPage() {
    if (!selectedPage) {
      return;
    }
    setIsDeletePageDialogOpen(true);
  }

  function closeDeletePageDialog() {
    setIsDeletePageDialogOpen(false);
  }

  function deleteCurrentPage() {
    if (!selectedPage) {
      closeDeletePageDialog();
      return;
    }

    const selectedPageKey = String(selectedPage.page);
    const selectedPageIndex = pages.findIndex((page) => String(page.page) === selectedPageKey);
    const nextPages = pages.filter((page) => String(page.page) !== selectedPageKey);
    const nextSelectedPage = nextPages[selectedPageIndex] || nextPages[selectedPageIndex - 1] || null;

    setPages(nextPages);
    setSelectedPageNumber(nextSelectedPage ? String(nextSelectedPage.page) : "");
    setImportSourcePageNumber((current) => nextPages.some((page) => String(page.page) === String(current)) ? current : (nextPages[0] ? String(nextPages[0].page) : ""));
    setSelectedIds([]);
    setSnapshotMessage("");
    setSnapshotError("");
    setSummary((current) => current ? {
      ...current,
      pageCount: nextPages.length,
      totalBooths: nextPages.reduce((sum, page) => sum + Number(page.entities?.booths?.length || 0), 0)
    } : current);
    closeDeletePageDialog();
  }

  function importEntitiesFromPage() {
    if (!selectedPage || !importSourcePageNumber) {
      return;
    }
    const sourcePage = pages.find((page) => String(page.page) === String(importSourcePageNumber));
    if (!sourcePage) {
      return;
    }
    const importedEntities = cloneEntitiesForPage(sourcePage, selectedPage.page);
    const importedIds = [
      ...importedEntities.halls,
      ...importedEntities.islands,
      ...importedEntities.groups,
      ...importedEntities.booths
    ].map((entity) => entity.id);
    updateSelectedPage((page) => {
      const entities = {
        booths: [...(page.entities.booths || []), ...importedEntities.booths],
        groups: [...(page.entities.groups || []), ...importedEntities.groups],
        islands: [...(page.entities.islands || []), ...importedEntities.islands],
        halls: [...(page.entities.halls || []), ...importedEntities.halls]
      };
      return { ...page, entities, boothCount: entities.booths.length };
    });
    setSelectedIds(importedIds);
  }

  function handleImageLoad(event) {
    const image = event.currentTarget;
    const nextSize = { naturalWidth: image.naturalWidth || 1, naturalHeight: image.naturalHeight || 1 };
    setImageSize(nextSize);
    updateSelectedPage((page) => ({
      ...page,
      renderedImageWidth: nextSize.naturalWidth,
      renderedImageHeight: nextSize.naturalHeight
    }));
  }

  function handleHallBackgroundLoad(event) {
    if (selectedPage?.renderedImageWidth > 1 && selectedPage?.renderedImageHeight > 1) {
      return;
    }
    const image = event.currentTarget;
    const nextSize = { naturalWidth: image.naturalWidth || 1, naturalHeight: image.naturalHeight || 1 };
    setImageSize(nextSize);
    updateSelectedPage((page) => ({
      ...page,
      renderedImageWidth: Math.max(page.renderedImageWidth || 1, nextSize.naturalWidth),
      renderedImageHeight: Math.max(page.renderedImageHeight || 1, nextSize.naturalHeight)
    }));
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function toCanvasPoint(event) {
    const viewport = viewportRef.current;
    if (!viewport) {
      return null;
    }
    const rect = viewport.getBoundingClientRect();
    return {
      x: canvasWorldRect.x + (viewport.scrollLeft + event.clientX - rect.left) / Math.max(zoom, 0.0001),
      y: canvasWorldRect.y + (viewport.scrollTop + event.clientY - rect.top) / Math.max(zoom, 0.0001)
    };
  }

  function buildRectFromPoints(startPoint, endPoint) {
    return {
      x: Math.min(startPoint.x, endPoint.x),
      y: Math.min(startPoint.y, endPoint.y),
      w: Math.abs(endPoint.x - startPoint.x),
      h: Math.abs(endPoint.y - startPoint.y)
    };
  }

  function refreshViewportMetrics() {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    setViewportMetrics({
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      clientWidth: viewport.clientWidth || 1,
      clientHeight: viewport.clientHeight || 1
    });
  }

  function scheduleViewportMetricsRefresh() {
    if (viewportFrameRef.current) {
      return;
    }
    viewportFrameRef.current = window.requestAnimationFrame(() => {
      viewportFrameRef.current = 0;
      refreshViewportMetrics();
    });
  }

  function handleViewportWheel(event) {
    const viewport = viewportRef.current;
    if (!viewport || !selectedPage) {
      return;
    }
    const wheelDelta = event.deltaY;
    if (event.altKey) {
      event.preventDefault();
      const nextZoom = clamp(zoom * (1 - wheelDelta * 0.0015), MIN_ZOOM, MAX_ZOOM);
      const rect = viewport.getBoundingClientRect();
      zoomAnchorRef.current = {
        contentX: canvasWorldRect.x + (viewport.scrollLeft + event.clientX - rect.left) / zoom,
        contentY: canvasWorldRect.y + (viewport.scrollTop + event.clientY - rect.top) / zoom,
        pointerX: event.clientX - rect.left,
        pointerY: event.clientY - rect.top,
        nextZoom
      };
      setZoom(nextZoom);
      return;
    }
    event.preventDefault();
    if (event.shiftKey) {
      viewport.scrollLeft += wheelDelta;
    } else {
      viewport.scrollTop += wheelDelta;
    }
    scheduleViewportMetricsRefresh();
  }

  useEffect(() => {
    const viewport = viewportRef.current;
    const anchor = zoomAnchorRef.current;
    if (!viewport || !anchor) {
      return;
    }
    viewport.scrollLeft = (anchor.contentX - canvasWorldRect.x) * anchor.nextZoom - anchor.pointerX;
    viewport.scrollTop = (anchor.contentY - canvasWorldRect.y) * anchor.nextZoom - anchor.pointerY;
    zoomAnchorRef.current = null;
    refreshViewportMetrics();
  }, [zoom, canvasWorldRect.x, canvasWorldRect.y]);

  function getMoveRootIds(ids) {
    if (!graph) {
      return [];
    }
    const idSet = new Set(ids);
    return ids.filter((id) => !graph.ancestorsOf(id).some((ancestor) => idSet.has(ancestor.id)));
  }

  function moveEntities(ids, deltaX, deltaY) {
    const roots = getMoveRootIds(ids);
    if (!roots.length || (!deltaX && !deltaY)) {
      return;
    }
    const undoGroupKey = `${selectedPageNumber}:${[...roots].sort().join("|")}`;
    const snapshots = roots
      .map((id) => graph?.byId.get(id))
      .filter(Boolean)
      .map((entity) => ({ id: entity.id, x: entity.x, y: entity.y }));
    if (snapshots.length && activeMoveUndoGroupRef.current !== undoGroupKey) {
      moveUndoStackRef.current = [
        ...moveUndoStackRef.current.slice(-49),
        { pageNumber: selectedPageNumber, selectedIds: [...selectedIds], snapshots, undoGroupKey }
      ];
      activeMoveUndoGroupRef.current = undoGroupKey;
    }
    updateSelectedPage((page) => createPageWithEntities(page, (entities) => updateEntities(entities, roots, (entity) => ({
      ...entity,
      ...(() => {
        const localDelta = graph.vectorToParentLocal(entity.parentId, { x: deltaX, y: deltaY });
        return { x: roundCoordinate(entity.x + localDelta.x), y: roundCoordinate(entity.y + localDelta.y) };
      })()
    }))));
  }

  function deleteSelectedEntities() {
    if (!selectedPage || !graph || !selectedIds.length) {
      return false;
    }
    const deleteIds = new Set(selectedIds.filter((id) => graph.byId.has(id)));
    if (!deleteIds.size) {
      return false;
    }
    const deletedParents = new Map([...deleteIds].map((id) => [id, graph.byId.get(id)]).filter(([, entity]) => Boolean(entity)));
    const deletedHallWithBackground = [...deletedParents.values()].find((entity) => entity.type === "hall" && entity.backgroundImagePath);
    const reparentIfNeeded = (entity) => {
      const deletedParent = deletedParents.get(entity.parentId);
      if (!deletedParent || deleteIds.has(entity.id)) {
        return entity;
      }
      const world = graph.getWorldTransform(entity.id);
      const nextParentId = deletedParent.parentId || "";
      const nextLocal = graph.pointToParentLocal(nextParentId, world);
      return {
        ...entity,
        parentId: nextParentId,
        x: roundCoordinate(nextLocal.x),
        y: roundCoordinate(nextLocal.y)
      };
    };
    const updateList = (list) => (list || [])
      .filter((entity) => !deleteIds.has(entity.id))
      .map(reparentIfNeeded);
    updateSelectedPage((page) => {
      const entities = {
        booths: updateList(page.entities.booths),
        groups: updateList(page.entities.groups),
        islands: updateList(page.entities.islands),
        halls: updateList(page.entities.halls)
      };
      return {
        ...page,
        renderedImagePath: page.renderedImagePath || deletedHallWithBackground?.backgroundImagePath || "",
        boothCount: entities.booths.length,
        entities
      };
    });
    setSelectedIds([]);
    return true;
  }

  function copySelectedEntities() {
    if (!selectedPage || !graph || !selectedIds.length) {
      return false;
    }
    const roots = getMoveRootIds(selectedIds).filter((id) => graph.byId.has(id));
    if (!roots.length) {
      return false;
    }

    const copiedIds = [];
    const seenIds = new Set();
    for (const rootId of roots) {
      for (const entity of [graph.byId.get(rootId), ...graph.descendantsOf(rootId)]) {
        if (!entity || seenIds.has(entity.id)) {
          continue;
        }
        seenIds.add(entity.id);
        copiedIds.push(entity.id);
      }
    }

    const rootIdSet = new Set(roots);
    const idMap = new Map(copiedIds.map((id, index) => {
      const entity = graph.byId.get(id);
      return [id, makeEntityId(entity?.type || "entity", selectedPage.page, index)];
    }));
    const copies = copiedIds
      .map((id) => graph.byId.get(id))
      .filter(Boolean)
      .map((entity) => ({
        ...entity,
        id: idMap.get(entity.id),
        parentId: idMap.get(entity.parentId) || entity.parentId || "",
        x: rootIdSet.has(entity.id) ? roundCoordinate(entity.x + 10) : entity.x,
        y: rootIdSet.has(entity.id) ? roundCoordinate(entity.y + 10) : entity.y
      }));

    updateSelectedPage((page) => {
      const copiesByType = {
        booths: copies.filter((entity) => entity.type === "booth"),
        groups: copies.filter((entity) => entity.type === "group"),
        islands: copies.filter((entity) => entity.type === "island"),
        halls: copies.filter((entity) => entity.type === "hall")
      };
      const entities = {
        booths: [...(page.entities.booths || []), ...copiesByType.booths],
        groups: [...(page.entities.groups || []), ...copiesByType.groups],
        islands: [...(page.entities.islands || []), ...copiesByType.islands],
        halls: [...(page.entities.halls || []), ...copiesByType.halls]
      };
      return { ...page, entities, boothCount: entities.booths.length };
    });
    setSelectedIds(roots.map((id) => idMap.get(id)).filter(Boolean));
    return true;
  }

  function addSelectedEntityToLarger() {
    if (!addToTarget || !graph) {
      return false;
    }
    const childWorld = graph.getWorldTransform(addToTarget.child.id);
    const childLocal = graph.pointToParentLocal(addToTarget.parent.id, childWorld);
    updateSelectedPage((page) => createPageWithEntities(page, (entities) => updateEntities(entities, [addToTarget.child.id], (entity) => ({
      ...entity,
      parentId: addToTarget.parent.id,
      x: roundCoordinate(childLocal.x),
      y: roundCoordinate(childLocal.y)
    }))));
    setSelectedIds([addToTarget.parent.id, addToTarget.child.id]);
    return true;
  }

  function createIslandFromSelectedBooths() {
    if (!selectedPage || !graph || !canCreateIslandFromSelectedBooths) {
      return false;
    }
    const boundary = rectFromWorldRects(selectedEntities.map((entity) => graph.getWorldRect(entity.id)));
    const island = normalizeIslandEntity({
      id: makeEntityId("island", selectedPage.page),
      x: roundCoordinate(boundary.x),
      y: roundCoordinate(boundary.y),
      raw: ""
    });
    const selectedBoothIds = new Set(selectedEntities.map((entity) => entity.id));
    updateSelectedPage((page) => createPageWithEntities(page, (entities) => ({
      ...entities,
      booths: (entities.booths || []).map((booth) => {
        if (!selectedBoothIds.has(booth.id)) {
          return booth;
        }
        const world = graph.getWorldTransform(booth.id);
        return { ...booth, parentId: island.id, x: roundCoordinate(world.x - island.x), y: roundCoordinate(world.y - island.y) };
      }),
      islands: [...(entities.islands || []), island]
    })));
    setSelectedIds([island.id]);
    return true;
  }

  function removeGroupsAndIslandsInsideSelection() {
    if (!selectedPage || !graph || !selectedIds.length) {
      return false;
    }
    const selectedIdSet = new Set(selectedIds);
    const deleteIds = new Set();
    for (const id of selectedIds) {
      for (const descendant of graph.descendantsOf(id)) {
        if ((descendant.type === "group" || descendant.type === "island") && !selectedIdSet.has(descendant.id)) {
          deleteIds.add(descendant.id);
        }
      }
    }
    if (!deleteIds.size) {
      return false;
    }

    const findRemainingParentId = (parentId) => {
      let nextParentId = parentId || "";
      while (nextParentId && deleteIds.has(nextParentId)) {
        nextParentId = graph.byId.get(nextParentId)?.parentId || "";
      }
      return nextParentId && graph.byId.has(nextParentId) ? nextParentId : "";
    };
    const updateList = (list) => (list || [])
      .filter((entity) => !deleteIds.has(entity.id))
      .map((entity) => {
        const nextParentId = findRemainingParentId(entity.parentId);
        if (nextParentId === (entity.parentId || "")) {
          return entity;
        }
        const world = graph.getWorldTransform(entity.id);
        const nextLocal = graph.pointToParentLocal(nextParentId, world);
        return {
          ...entity,
          parentId: nextParentId,
          x: roundCoordinate(nextLocal.x),
          y: roundCoordinate(nextLocal.y)
        };
      });
    updateSelectedPage((page) => {
      const entities = {
        booths: updateList(page.entities.booths),
        groups: updateList(page.entities.groups),
        islands: updateList(page.entities.islands),
        halls: updateList(page.entities.halls)
      };
      return { ...page, entities, boothCount: entities.booths.length };
    });
    setSelectedIds(selectedIds.filter((id) => !deleteIds.has(id)));
    return true;
  }

  function splitSelectedIslandsAtMouse(axis = "horizontal") {
    const splitPoint = lastCanvasPointRef.current;
    if (!selectedPage || !graph || !selectedAreOnlyIslands || !selectedIslands.length || !splitPoint) {
      return false;
    }
    const isVertical = axis === "vertical";
    const newIslands = [];
    const childUpdates = new Map();

    for (const island of selectedIslands) {
      const directChildren = (graph.childrenByParent.get(island.id) || [])
        .map((id) => graph.byId.get(id))
        .filter(Boolean);
      if (directChildren.length < 2) {
        continue;
      }
      const beforeChildren = [];
      const afterChildren = [];
      for (const child of directChildren) {
        const rect = graph.getWorldRect(child.id);
        if (!rect) {
          continue;
        }
        const childCenter = isVertical ? rect.x + rect.w / 2 : rect.y + rect.h / 2;
        const splitCoordinate = isVertical ? splitPoint.x : splitPoint.y;
        if (childCenter < splitCoordinate) {
          beforeChildren.push(child);
        } else {
          afterChildren.push(child);
        }
      }
      if (!beforeChildren.length || !afterChildren.length) {
        continue;
      }

      const parentWorld = island.parentId && graph.byId.has(island.parentId)
        ? graph.getWorldTransform(island.parentId)
        : { x: 0, y: 0, rotation: 0, scale: 1 };
      const afterBoundary = rectFromWorldRects(afterChildren.map((child) => graph.getWorldRect(child.id)));
      const newIslandLocal = graph.pointToParentLocal(island.parentId, afterBoundary);
      const newIsland = normalizeIslandEntity({
        id: makeEntityId("island", selectedPage.page, newIslands.length),
        parentId: island.parentId || "",
        x: roundCoordinate(newIslandLocal.x),
        y: roundCoordinate(newIslandLocal.y),
        raw: ""
      });
      newIslands.push(newIsland);

      const newIslandWorld = {
        ...transformPoint(parentWorld, { x: newIsland.x, y: newIsland.y }),
        rotation: parentWorld.rotation,
        scale: parentWorld.scale
      };
      for (const child of afterChildren) {
        const childWorld = graph.getWorldTransform(child.id);
        const childLocal = inverseTransformPoint(newIslandWorld, childWorld);
        childUpdates.set(child.id, {
          parentId: newIsland.id,
          x: roundCoordinate(childLocal.x),
          y: roundCoordinate(childLocal.y)
        });
      }
    }

    if (!newIslands.length) {
      return false;
    }

    updateSelectedPage((page) => createPageWithEntities(page, (entities) => ({
      booths: (entities.booths || []).map((entity) => childUpdates.has(entity.id) ? { ...entity, ...childUpdates.get(entity.id) } : entity),
      groups: (entities.groups || []).map((entity) => childUpdates.has(entity.id) ? { ...entity, ...childUpdates.get(entity.id) } : entity),
      islands: [
        ...(entities.islands || []).map((entity) => childUpdates.has(entity.id) ? { ...entity, ...childUpdates.get(entity.id) } : entity),
        ...newIslands
      ],
      halls: (entities.halls || []).map((entity) => childUpdates.has(entity.id) ? { ...entity, ...childUpdates.get(entity.id) } : entity)
    })));
    setSelectedIds([...selectedIslands.map((island) => island.id), ...newIslands.map((island) => island.id)]);
    return true;
  }

  function splitBoothsInSelectedIslands() {
    if (!selectedPage || !graph || !canSplitBoothsInSelectedIslands) {
      return false;
    }
    const islandIds = new Set(selectedIslands.map((island) => island.id));
    const selectedBooths = selectedIslands.flatMap((island) => graph.boothDescendantsOf(island.id));
    const splitSourceIds = new Set(selectedBooths.map((booth) => booth.id));
    if (!splitSourceIds.size) {
      return false;
    }

    const splitBoothsBySourceId = new Map();
    for (const island of selectedIslands) {
      const booths = graph.boothDescendantsOf(island.id);
      const entries = booths
        .map((booth) => {
          const rect = graph.getWorldRect(booth.id);
          return rect ? { booth, rect, centerX: rect.x + rect.w / 2, centerY: rect.y + rect.h / 2 } : null;
        })
        .filter(Boolean);
      if (!entries.length) {
        continue;
      }
      const boundary = rectFromWorldRects(entries.map((entry) => entry.rect));
      const axis = boundary.h > boundary.w ? "vertical" : "horizontal";
      const entryByBoothId = new Map(entries.map((entry) => [entry.booth.id, entry]));
      const cornerRotations = new Map();
      const groups = graph.descendantsOf(island.id).filter((entity) => entity.type === "group");
      for (const group of groups) {
        const groupEntries = graph.boothDescendantsOf(group.id).map((booth) => entryByBoothId.get(booth.id)).filter(Boolean);
        for (const [boothId, rotationDirection] of collectDoubleLaneGroupCornerRotations(groupEntries, axis).entries()) {
          cornerRotations.set(boothId, rotationDirection);
        }
      }
      for (const entry of entries) {
        const rotationDirection = cornerRotations.get(entry.booth.id);
        const splitAxis = rotationDirection ? oppositeAxis(axis) : axis;
        const suffixes = rotationDirection
          ? rotateSplitSuffixes(inferSplitSuffixes(entry, entries, axis), axis, rotationDirection)
          : inferSplitSuffixes(entry, entries, axis);
        const before = {
          ...entry.booth,
          id: makeEntityId("booth", selectedPage.page, `${entry.booth.id}-a`),
          boothSuffix: suffixes.before,
          splitIndex: 0
        };
        const after = {
          ...entry.booth,
          id: makeEntityId("booth", selectedPage.page, `${entry.booth.id}-b`),
          boothSuffix: suffixes.after,
          splitIndex: 1
        };
        if (splitAxis === "vertical") {
          const beforeHeight = Math.max(1, roundCoordinate(entry.booth.h / 2));
          const afterHeight = Math.max(1, roundCoordinate(entry.booth.h - beforeHeight));
          before.h = beforeHeight;
          after.y = roundCoordinate(entry.booth.y + beforeHeight);
          after.h = afterHeight;
        } else {
          const beforeWidth = Math.max(1, roundCoordinate(entry.booth.w / 2));
          const afterWidth = Math.max(1, roundCoordinate(entry.booth.w - beforeWidth));
          before.w = beforeWidth;
          after.x = roundCoordinate(entry.booth.x + beforeWidth);
          after.w = afterWidth;
        }
        splitBoothsBySourceId.set(entry.booth.id, [before, after]);
      }
    }

    if (!splitBoothsBySourceId.size) {
      return false;
    }

    updateSelectedPage((page) => createPageWithEntities(page, (entities) => ({
      ...entities,
      booths: (entities.booths || []).flatMap((booth) => splitBoothsBySourceId.get(booth.id) || [booth])
    })));
    setSelectedIds(selectedIds.filter((id) => islandIds.has(id)));
    return true;
  }

  function undoLastMove() {
    const stack = moveUndoStackRef.current;
    if (!stack.length) {
      return false;
    }
    const entry = stack[stack.length - 1];
    if (String(entry.pageNumber) !== String(selectedPageNumber)) {
      return false;
    }
    moveUndoStackRef.current = stack.slice(0, -1);
    activeMoveUndoGroupRef.current = null;
    const snapshotById = new Map(entry.snapshots.map((snapshot) => [snapshot.id, snapshot]));
    updateSelectedPage((page) => createPageWithEntities(page, (entities) => updateEntities(entities, [...snapshotById.keys()], (entity) => {
      const snapshot = snapshotById.get(entity.id);
      return snapshot ? { ...entity, x: snapshot.x, y: snapshot.y } : entity;
    })));
    setSelectedIds(entry.selectedIds || []);
    return true;
  }

  function updateEntityLocalPosition(ids, field, value) {
    if (!selectedRect || value === "") {
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return;
    }
    const delta = parsed - selectedRect[field];
    moveEntities(ids, field === "x" ? delta : 0, field === "y" ? delta : 0);
  }

  function updateSingleEntityPosition(entity, field, value) {
    if (!entity || value === "") {
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return;
    }
    const delta = parsed - entity[field];
    moveEntities([entity.id], field === "x" ? delta : 0, field === "y" ? delta : 0);
  }

  function updateEntityField(entityId, field, value) {
    updateSelectedPage((page) => createPageWithEntities(page, (entities) => updateEntities(entities, [entityId], (entity) => {
      if (field === "x" || field === "y" || field === "rotation" || field === "scale" || field === "backgroundOffsetX" || field === "backgroundOffsetY" || field === "trim") {
        if (value === "") {
          return entity;
        }
        const parsed = Number(value);
        if (field === "scale") {
          return Number.isFinite(parsed) ? { ...entity, scale: normalizeScale(parsed) } : entity;
        }
        return Number.isFinite(parsed) ? { ...entity, [field]: field === "trim" ? Math.max(0, Math.round(parsed)) : roundCoordinate(parsed) } : entity;
      }
      if (field === "w" || field === "h") {
        if (value === "") {
          return entity;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? { ...entity, [field]: Math.max(1, Math.round(parsed)) } : entity;
      }
      if (field === "boothSuffix") {
        return { ...entity, boothSuffix: normalizeBoothSuffix(value) };
      }
      return { ...entity, [field]: String(value || "") };
    })));
  }

  function updateHallRotation(entityId, rotation) {
    updateSelectedPage((page) => createPageWithEntities(page, (entities) => updateEntities(entities, [entityId], (entity) => ({
      ...entity,
      rotation: roundCoordinate(rotation)
    }))));
  }

  function hitHallHandleAtPoint(point) {
    if (!selectedPage || !graph) {
      return null;
    }
    const halls = selectedPage.entities.halls || [];
    for (let index = halls.length - 1; index >= 0; index -= 1) {
      const hall = halls[index];
      const handles = hallHandlePoints(hall, graph);
      if (!handles) {
        continue;
      }
      if (Math.hypot(point.x - handles.rotate.x, point.y - handles.rotate.y) <= HALL_HANDLE_HIT_RADIUS) {
        return { type: "rotate", hall, handles };
      }
      if (Math.hypot(point.x - handles.move.x, point.y - handles.move.y) <= HALL_HANDLE_HIT_RADIUS) {
        return { type: "move", hall, handles };
      }
    }
    return null;
  }

  function hitPathAtPoint(point) {
    if (!selectedPage || !graph) {
      return [];
    }
    const halls = selectedPage.entities.halls || [];
    for (let index = halls.length - 1; index >= 0; index -= 1) {
      const hall = halls[index];
      const handles = hallHandlePoints(hall, graph);
      if (handles && Math.hypot(point.x - handles.move.x, point.y - handles.move.y) <= HALL_HANDLE_HIT_RADIUS) {
        return [hall];
      }
    }
    const booths = selectedPage.entities.booths || [];
    for (let index = booths.length - 1; index >= 0; index -= 1) {
      const booth = booths[index];
      const rect = graph.getWorldRect(booth.id);
      const polygon = graph.getWorldPolygon(booth.id);
      if (!rect || !pointInRect(point, rect) || !pointInPolygon(point, polygon)) {
        continue;
      }
      return [booth, ...graph.ancestorsOf(booth.id).filter((entity) => entity.type !== "hall")];
    }
    const boundaryLists = [
      selectedPage.entities.groups || [],
      selectedPage.entities.islands || [],
      selectedPage.entities.halls || []
    ];
    for (const entities of boundaryLists) {
      for (let index = entities.length - 1; index >= 0; index -= 1) {
        const entity = entities[index];
        const rect = graph.getWorldRect(entity.id);
        const polygon = graph.getWorldPolygon(entity.id);
        if (!rect || !pointInRect(point, rect) || !pointInPolygon(point, polygon)) {
          continue;
        }
        return entity.type === "hall" ? [entity] : [entity, ...graph.ancestorsOf(entity.id).filter((ancestor) => ancestor.type !== "hall")];
      }
    }
    return [];
  }

  function selectFromHitPath(path, event) {
    const isToggleSelection = Boolean(event?.ctrlKey || event?.metaKey || event?.shiftKey);
    if (!path.length) {
      if (!isToggleSelection) {
        setSelectedIds([]);
      }
      return null;
    }
    const hitHall = path[0]?.type === "hall";
    const nextTarget = hitHall
      ? path[0]
      : (() => {
          const topDown = [...path].reverse();
          const currentIndex = topDown.findIndex((entity) => selectedIds.length === 1 && selectedIds[0] === entity.id);
          return currentIndex >= 0 && currentIndex < topDown.length - 1 ? topDown[currentIndex + 1] : topDown[0];
        })();
    if (isToggleSelection) {
      const nextIds = selectedIds.includes(nextTarget.id)
        ? selectedIds.filter((id) => id !== nextTarget.id)
        : [...selectedIds, nextTarget.id];
      setSelectedIds(nextIds);
      return { target: nextTarget, selectedIds: nextIds };
    } else {
      setSelectedIds([nextTarget.id]);
    }
    return { target: nextTarget, selectedIds: [nextTarget.id] };
  }

  function startCanvasInteraction(event) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    if (isSpacePanning) {
      dragRef.current = {
        mode: "panCanvas",
        startClientX: event.clientX,
        startClientY: event.clientY,
        startScrollLeft: viewportRef.current?.scrollLeft || 0,
        startScrollTop: viewportRef.current?.scrollTop || 0
      };
      return;
    }
    const point = toCanvasPoint(event);
    if (!point) {
      return;
    }
    const path = hitPathAtPoint(point);
    const hallHandle = hitHallHandleAtPoint(point);
    if (hallHandle) {
      setSelectedIds([hallHandle.hall.id]);
      if (hallHandle.type === "rotate") {
        dragRef.current = {
          mode: "rotateHall",
          hallId: hallHandle.hall.id,
          center: hallHandle.handles.center,
          startAngle: angleDegrees(hallHandle.handles.center, point),
          startRotation: asFiniteNumber(hallHandle.hall.rotation, 0)
        };
        return;
      }
      dragRef.current = { startClientX: event.clientX, startClientY: event.clientY, ids: [hallHandle.hall.id], deltaX: 0, deltaY: 0 };
      return;
    }
    const selection = selectFromHitPath(path, event);
    if (selection?.target && selection.selectedIds.includes(selection.target.id)) {
      dragRef.current = { startClientX: event.clientX, startClientY: event.clientY, ids: selection.selectedIds, deltaX: 0, deltaY: 0 };
      return;
    }
    marqueeRef.current = { startPoint: point, currentPoint: point, additive: Boolean(event.shiftKey) };
    setMarquee({ x: point.x, y: point.y, w: 0, h: 0 });
  }

  function collectTopSelectableIds(selectionRect = null) {
    if (!graph || !selectedPage) {
      return [];
    }

    const hitIds = [];
    for (const booth of selectedPage.entities.booths) {
      const path = [booth, ...graph.ancestorsOf(booth.id).filter((entity) => entity.type !== "hall")];
      const top = [...path].reverse()[0];
      const topRect = graph.getWorldRect(top.id);
      const isHit = selectionRect ? topRect && rectanglesIntersect(selectionRect, topRect) : Boolean(topRect);
      if (isHit && !hitIds.includes(top.id)) {
        hitIds.push(top.id);
      }
    }
    return hitIds;
  }

  function completeMarqueeSelection() {
    if (!marqueeRef.current || !graph || !selectedPage) {
      return;
    }
    const rect = buildRectFromPoints(marqueeRef.current.startPoint, marqueeRef.current.currentPoint);
    if (rect.w < 2 || rect.h < 2) {
      return;
    }
    const hitIds = collectTopSelectableIds(rect);
    if (marqueeRef.current.additive) {
      setSelectedIds((currentIds) => [...new Set([...currentIds, ...hitIds])]);
    } else {
      setSelectedIds(hitIds);
    }
  }

  function handleCanvasContextMenu(event) {
    event.preventDefault();
    const point = toCanvasPoint(event);
    if (!point || !selectedPage) {
      return;
    }
    const source = selectedPage.entities.booths[0];
    const w = source?.w || 24;
    const h = source?.h || 24;
    const nextBooth = normalizeBoothEntity({
      id: makeEntityId("booth", selectedPage.page),
      page: selectedPage.page,
      x: roundCoordinate(point.x - w / 2),
      y: roundCoordinate(point.y - h / 2),
      w,
      h
    });
    updateSelectedPage((page) => ({
      ...page,
      entities: { ...page.entities, booths: [...page.entities.booths, nextBooth] },
      boothCount: page.entities.booths.length + 1
    }));
    setSelectedIds([nextBooth.id]);
  }

  useEffect(() => {
    function handleMouseMove(event) {
      const point = toCanvasPoint(event);
      if (point) {
        lastCanvasPointRef.current = point;
      }
      if (marqueeRef.current) {
        if (!point) {
          return;
        }
        marqueeRef.current.currentPoint = point;
        setMarquee(buildRectFromPoints(marqueeRef.current.startPoint, point));
        return;
      }
      if (!dragRef.current) {
        return;
      }
      if (dragRef.current.mode === "panCanvas") {
        const viewport = viewportRef.current;
        if (!viewport) {
          return;
        }
        viewport.scrollLeft = dragRef.current.startScrollLeft - (event.clientX - dragRef.current.startClientX);
        viewport.scrollTop = dragRef.current.startScrollTop - (event.clientY - dragRef.current.startClientY);
        scheduleViewportMetricsRefresh();
        return;
      }
      if (dragRef.current.mode === "rotateHall") {
        if (!point) {
          return;
        }
        const deltaRotation = angleDegrees(dragRef.current.center, point) - dragRef.current.startAngle;
        updateHallRotation(dragRef.current.hallId, dragRef.current.startRotation + deltaRotation);
        setDragTick((current) => current + 1);
        return;
      }
      dragRef.current.deltaX = (event.clientX - dragRef.current.startClientX) / Math.max(zoom, 0.0001);
      dragRef.current.deltaY = (event.clientY - dragRef.current.startClientY) / Math.max(zoom, 0.0001);
      setDragTick((current) => current + 1);
    }

    function handleMouseUp() {
      if (marqueeRef.current) {
        completeMarqueeSelection();
        marqueeRef.current = null;
        setMarquee(null);
      }
      if (dragRef.current) {
        const drag = dragRef.current;
        if (drag.mode !== "rotateHall" && drag.mode !== "panCanvas") {
          moveEntities(drag.ids, drag.deltaX, drag.deltaY);
        }
        dragRef.current = null;
        setDragTick((current) => current + 1);
      }
    }

    function handleKeyDown(event) {
      const target = event.target;
      const isEditable = Boolean(target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || "")));
      if (isEditable) {
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.code === "Space") {
        event.preventDefault();
        setIsSpacePanning(true);
        return;
      }
      const isSaveShortcut = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "s";
      if (isSaveShortcut) {
        event.preventDefault();
        if (pages.length && !isSavingSnapshot && !loading) {
          saveSnapshot();
        }
        return;
      }
      const isUndoShortcut = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z";
      if (isUndoShortcut) {
        if (undoLastMove()) {
          event.preventDefault();
        }
        return;
      }
      const isCopyShortcut = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "c";
      if (isCopyShortcut) {
        if (copySelectedEntities()) {
          event.preventDefault();
        }
        return;
      }
      const isVerticalSplitIslandsShortcut = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "y";
      if (isVerticalSplitIslandsShortcut) {
        if (splitSelectedIslandsAtMouse("vertical")) {
          event.preventDefault();
        }
        return;
      }
      const isSplitIslandsShortcut = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "x";
      if (isSplitIslandsShortcut) {
        if (splitSelectedIslandsAtMouse()) {
          event.preventDefault();
        }
        return;
      }
      const isSelectAllShortcut = !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "a";
      if (isSelectAllShortcut) {
        event.preventDefault();
        setSelectedIds(collectTopSelectableIds());
        return;
      }
      const isMergeIslandsShortcut = !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "m";
      if (isMergeIslandsShortcut) {
        if (canMergeSelectedIslands) {
          event.preventDefault();
          mergeSelectedIslands();
        } else if (canMergeSelectedGroups) {
          event.preventDefault();
          mergeSelectedGroups();
        }
        return;
      }
      const isAddToShortcut = !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "g";
      if (isAddToShortcut) {
        if (addSelectedEntityToLarger() || createIslandFromSelectedBooths()) {
          event.preventDefault();
        }
        return;
      }
      const isUngroupShortcut = !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "u";
      if (isUngroupShortcut) {
        if (removeGroupsAndIslandsInsideSelection()) {
          event.preventDefault();
        }
        return;
      }
      const isConfirmShortcut = !event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Enter";
      if (isConfirmShortcut) {
        if (splitBoothsInSelectedIslands()) {
          event.preventDefault();
        }
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Delete") {
        if (deleteSelectedEntities()) {
          event.preventDefault();
        }
        return;
      }
      const arrowSteps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const arrowDelta = arrowSteps[event.key];
      if (!arrowDelta || !selectedIds.length) {
        return;
      }
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      moveEntities(selectedIds, arrowDelta[0] * step, arrowDelta[1] * step);
    }

    function handleKeyUp(event) {
      if (event.code === "Space") {
        setIsSpacePanning(false);
      }
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [graph, selectedPage, selectedIds, zoom, isSpacePanning]);

  function drawCanvasOverlay() {
    const canvas = canvasRef.current;
    if (!canvas || !selectedPage || !graph) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, canvasWorldRect.w || 1);
    const height = Math.max(1, canvasWorldRect.h || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.translate(-canvasWorldRect.x, -canvasWorldRect.y);
    context.font = "12px sans-serif";

    const drag = dragRef.current;
    const dragIds = new Set(drag?.ids || []);
    const rootDragIds = new Set(getMoveRootIds(drag?.ids || []));
    const selectedIdSet = new Set(selectedIds);
    const drawRect = (entity, pad = 0) => {
      const rect = graph.getWorldRect(entity.id);
      const polygon = graph.getWorldPolygon(entity.id, pad);
      const visualRect = rectFromPoints(polygon);
      if (!rect || (viewportRect && !rectanglesIntersect(viewportRect, visualRect))) {
        return;
      }
      const moveOffset = rootDragIds.has(entity.id) || graph.ancestorsOf(entity.id).some((ancestor) => rootDragIds.has(ancestor.id))
        ? { x: drag?.deltaX || 0, y: drag?.deltaY || 0 }
        : { x: 0, y: 0 };
      const style = ENTITY_STYLE[entity.type];
      const selected = selectedIdSet.has(entity.id) || dragIds.has(entity.id);
      context.beginPath();
      polygon.forEach((point, index) => {
        const x = point.x + moveOffset.x;
        const y = point.y + moveOffset.y;
        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      });
      context.closePath();
      context.fillStyle = style.fill;
      context.strokeStyle = selected ? "#cb4b16" : style.stroke;
      context.lineWidth = selected ? 2.5 : 1.2;
      context.fill();
      context.stroke();
      if (showMapLabels && entity.type === "booth") {
        const label = `${entity.boothNumber || ""}${entity.boothSuffix || ""}`.trim();
        if (label) {
          context.fillStyle = "#0f4c81";
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.font = `${Math.max(12, Math.min(rect.w, rect.h) * 0.5)}px sans-serif`;
          context.fillText(label, rect.x + moveOffset.x + rect.w / 2, rect.y + moveOffset.y + rect.h / 2);
        }
      }
      if (showMapLabels && entity.type === "island" && entity.raw) {
        const label = String(entity.raw).trim();
        if (label) {
          const labelAnchor = topEdgeLabelAnchor(graph.getWorldPolygon(entity.id));
          const x = labelAnchor.x + moveOffset.x;
          const y = Math.max(12, labelAnchor.y + moveOffset.y);
          context.font = "14px sans-serif";
          context.textAlign = "center";
          context.textBaseline = "bottom";
          const metrics = context.measureText(label);
          context.fillStyle = "rgba(255, 250, 240, 0.86)";
          context.fillRect(x - metrics.width / 2 - 4, y - 17, metrics.width + 8, 18);
          context.fillStyle = selected ? "#8a2d12" : "#5e3f9c";
          context.fillText(label, x, y - 2);
        }
      }
      if (entity.type === "hall") {
        const handles = hallHandlePoints(entity, graph);
        if (!handles) {
          return;
        }
        const moveHandle = { x: handles.move.x + moveOffset.x, y: handles.move.y + moveOffset.y };
        const rotateHandle = { x: handles.rotate.x + moveOffset.x, y: handles.rotate.y + moveOffset.y };
        const rotateBase = { x: handles.rotateBase.x + moveOffset.x, y: handles.rotateBase.y + moveOffset.y };
        context.beginPath();
        context.moveTo(rotateBase.x, rotateBase.y);
        context.lineTo(rotateHandle.x, rotateHandle.y);
        context.strokeStyle = selected ? "#cb4b16" : ENTITY_STYLE.hall.stroke;
        context.lineWidth = 1.2;
        context.stroke();
        context.beginPath();
        context.arc(moveHandle.x, moveHandle.y, 6, 0, Math.PI * 2);
        context.fillStyle = selected ? "#cb4b16" : ENTITY_STYLE.hall.stroke;
        context.fill();
        context.beginPath();
        context.arc(rotateHandle.x, rotateHandle.y, 6, 0, Math.PI * 2);
        context.fillStyle = "#ffffff";
        context.fill();
        context.strokeStyle = selected ? "#cb4b16" : ENTITY_STYLE.hall.stroke;
        context.lineWidth = 2;
        context.stroke();
      }
    };

    selectedPage.entities.halls.forEach((entity) => drawRect(entity, 12));
    selectedPage.entities.islands.forEach((entity) => drawRect(entity, 8));
    selectedPage.entities.groups.forEach((entity) => drawRect(entity, 4));
    selectedPage.entities.booths.forEach((entity) => drawRect(entity, 0));

    if (marquee) {
      context.setLineDash([6, 4]);
      context.beginPath();
      context.rect(marquee.x, marquee.y, Math.max(1, marquee.w), Math.max(1, marquee.h));
      context.fillStyle = "rgba(180, 150, 255, 0.12)";
      context.strokeStyle = "rgba(130, 80, 220, 0.95)";
      context.fill();
      context.stroke();
      context.setLineDash([]);
    }
  }

  useEffect(() => {
    drawCanvasOverlay();
  }, [selectedPage, graph, canvasSize, canvasWorldRect, zoom, selectedIds, marquee, dragTick, viewportRect, showMapLabels]);

  function resetView() {
    setZoom(1);
    if (viewportRef.current) {
      viewportRef.current.scrollLeft = 0 - canvasWorldRect.x;
      viewportRef.current.scrollTop = 0 - canvasWorldRect.y;
    }
    refreshViewportMetrics();
  }

  function fixMap() {
    if (!selectedPage) {
      return;
    }
    updateSelectedPage((page) => buildGroupsFromBooths(page, {
      sizeOffset: fixMapBoothSizeOffset,
      explicitWidth: fixMapBoothSizeWidth,
      explicitHeight: fixMapBoothSizeHeight
    }));
    setSelectedIds([]);
  }

  function buildIslands() {
    if (!selectedPage) {
      return;
    }
    updateSelectedPage(buildIslandsFromGroups);
    setSelectedIds([]);
  }

  function mergeSelectedGroups() {
    if (!selectedPage || !graph || selectedGroups.length < 2) {
      return;
    }
    const mergeIdSet = new Set(selectedGroups.map((group) => group.id));
    const keep = selectedGroups.find((group) => !graph.ancestorsOf(group.id).some((ancestor) => mergeIdSet.has(ancestor.id))) || selectedGroups[0];
    const reparentFromMergedGroup = (entity) => {
      if (!mergeIdSet.has(entity.parentId) || entity.parentId === keep.id || mergeIdSet.has(entity.id)) {
        return entity;
      }
      const world = graph.getWorldTransform(entity.id);
      const local = graph.pointToParentLocal(keep.id, world);
      return { ...entity, parentId: keep.id, x: roundCoordinate(local.x), y: roundCoordinate(local.y) };
    };
    updateSelectedPage((page) => createPageWithEntities(page, (entities) => ({
      booths: (entities.booths || []).map(reparentFromMergedGroup),
      groups: (entities.groups || []).map(reparentFromMergedGroup).filter((group) => group.id === keep.id || !mergeIdSet.has(group.id)),
      islands: (entities.islands || []).map(reparentFromMergedGroup),
      halls: (entities.halls || []).map(reparentFromMergedGroup)
    })));
    setSelectedIds([keep.id]);
  }

  function mergeSelectedIslands() {
    if (!selectedPage || !graph || selectedIslands.length < 2) {
      return;
    }
    const keep = selectedIslands[0];
    const mergeIdSet = new Set(selectedIslands.map((island) => island.id));
    updateSelectedPage((page) => createPageWithEntities(page, (entities) => {
      const nextGroups = entities.groups.map((group) => {
        if (!mergeIdSet.has(group.parentId) || group.parentId === keep.id) {
          return group;
        }
        const world = graph.getWorldTransform(group.id);
        const local = graph.pointToParentLocal(keep.id, world);
        return { ...group, parentId: keep.id, x: roundCoordinate(local.x), y: roundCoordinate(local.y) };
      });
      return {
        ...entities,
        groups: nextGroups,
        islands: entities.islands.filter((island) => island.id === keep.id || !mergeIdSet.has(island.id))
      };
    }));
    setSelectedIds([keep.id]);
  }

  function createHallFromSelectedIslands() {
    if (!selectedPage || !graph || !selectedAreOnlyIslands) {
      return;
    }
    const boundary = rectFromWorldRects(selectedIslands.map((island) => graph.getWorldRect(island.id)));
    const hall = normalizeHallEntity({
      id: makeEntityId("H", selectedPage.page),
      x: boundary.x,
      y: boundary.y,
      rotation: 0,
      scale: 1,
      backgroundImagePath: selectedPage.renderedImagePath,
      backgroundOffsetX: -boundary.x,
      backgroundOffsetY: -boundary.y
    });
    const hallTransform = { x: hall.x, y: hall.y, rotation: hall.rotation, scale: hall.scale };
    const selectedIslandIdSet = new Set(selectedIds);
    updateSelectedPage((page) => ({
      ...createPageWithEntities(page, (entities) => ({
        ...entities,
        halls: [...entities.halls, hall],
        islands: entities.islands.map((island) => {
          if (!selectedIslandIdSet.has(island.id)) {
            return island;
          }
          const local = inverseTransformPoint(hallTransform, graph.getWorldTransform(island.id));
          return { ...island, parentId: hall.id, x: roundCoordinate(local.x), y: roundCoordinate(local.y) };
        })
      })),
      renderedImagePath: "",
      renderedImageWidth: canvasSize.naturalWidth,
      renderedImageHeight: canvasSize.naturalHeight
    }));
    setSelectedIds([hall.id]);
  }

  function renderHallBackgrounds() {
    if (!selectedPage || !graph) {
      return null;
    }
    return selectedPage.entities.halls
      .filter((hall) => hall.backgroundImagePath)
      .map((hall) => {
        const transform = graph.getWorldTransform(hall.id);
        const rect = graph.getWorldRect(hall.id);
        if (!rect) {
          return null;
        }
        const drag = dragRef.current;
        const rootDragIds = new Set(getMoveRootIds(drag?.ids || []));
        const moveOffset = rootDragIds.has(hall.id) ? { x: drag?.deltaX || 0, y: drag?.deltaY || 0 } : { x: 0, y: 0 };
        const trim = Math.max(0, Math.round(asFiniteNumber(hall.trim, 0)));
        const clipPolygon = graph.getWorldPolygonWithLocalPad(hall.id, trim);
        const clipRect = rectFromPoints(clipPolygon);
        const clipPath = `polygon(${clipPolygon.map((point) => `${roundCoordinate(point.x - clipRect.x)}px ${roundCoordinate(point.y - clipRect.y)}px`).join(", ")})`;
        return (
          <Box
            key={`hall-bg-${hall.id}`}
            sx={{
              position: "absolute",
              left: `${clipRect.x + moveOffset.x - canvasWorldRect.x}px`,
              top: `${clipRect.y + moveOffset.y - canvasWorldRect.y}px`,
              width: `${clipRect.w}px`,
              height: `${clipRect.h}px`,
              overflow: "hidden",
              clipPath,
              pointerEvents: "none",
              userSelect: "none"
            }}
          >
            <Box
              sx={{
                position: "absolute",
                left: `${transform.x - clipRect.x}px`,
                top: `${transform.y - clipRect.y}px`,
                width: 0,
                height: 0,
                transform: `rotate(${transform.rotation || 0}deg) scale(${normalizeScale(transform.scale)})`,
                transformOrigin: "0 0",
                pointerEvents: "none",
                userSelect: "none"
              }}
            >
              <Box
                component="img"
                src={toImageUrl(hall.backgroundImagePath)}
                alt=""
                onLoad={handleHallBackgroundLoad}
                draggable={false}
                sx={{
                  position: "absolute",
                  left: `${hall.backgroundOffsetX || 0}px`,
                  top: `${hall.backgroundOffsetY || 0}px`,
                  width: `${canvasSize.naturalWidth}px`,
                  height: `${canvasSize.naturalHeight}px`,
                  display: "block",
                  pointerEvents: "none",
                  userSelect: "none"
                }}
              />
            </Box>
          </Box>
        );
      });
  }

  function applyIslandSequenceLabels() {
    if (!graph || selectedIslands.length < 2) {
      return;
    }
    const sorted = sortIslandsForSequence(selectedIslands, graph, islandSequenceDirection);
    const labels = buildIslandSequenceLabels(islandSequenceStart, sorted.length);
    const labelMap = new Map(sorted.map((island, index) => [island.id, labels[index] || ""]));
    updateSelectedPage((page) => createPageWithEntities(page, (entities) => updateEntities(entities, sorted.map((island) => island.id), (entity) => ({
      ...entity,
      raw: labelMap.get(entity.id) || ""
    }))));
  }

  function applyIslandBoothNumbering() {
    if (!graph || !selectedIslands.length) {
      return;
    }
    const parsedStart = Number.parseInt(String(islandNumberingStart || "1"), 10);
    const startNumber = Number.isFinite(parsedStart) && parsedStart > 0 ? parsedStart : 1;
    const numberMap = new Map();
    for (const island of selectedIslands) {
      const orderedBooths = buildSerpentineBoothOrder(graph.boothDescendantsOf(island.id), graph, islandNumberingCorner);
      orderedBooths.forEach((booth, index) => {
        const numberOffset = islandNumberingPairMode ? Math.floor(index / 2) : index;
        numberMap.set(booth.id, String(startNumber + numberOffset));
      });
    }
    updateSelectedPage((page) => createPageWithEntities(page, (entities) => updateEntities(entities, [...numberMap.keys()], (entity) => ({
      ...entity,
      boothNumber: numberMap.get(entity.id) || entity.boothNumber
    }))));
  }

  function renderTransformFields(ids, rect) {
    return (
      <Stack direction="row" spacing={1}>
        <TextField size="small" label="X" type="number" value={roundCoordinate(rect?.x || 0)} onChange={(event) => updateEntityLocalPosition(ids, "x", event.target.value)} fullWidth />
        <TextField size="small" label="Y" type="number" value={roundCoordinate(rect?.y || 0)} onChange={(event) => updateEntityLocalPosition(ids, "y", event.target.value)} fullWidth />
      </Stack>
    );
  }

  function renderSingleTransformFields(entity) {
    return (
      <Stack direction="row" spacing={1}>
        <TextField size="small" label="X" type="number" value={roundCoordinate(entity.x || 0)} onChange={(event) => updateSingleEntityPosition(entity, "x", event.target.value)} fullWidth />
        <TextField size="small" label="Y" type="number" value={roundCoordinate(entity.y || 0)} onChange={(event) => updateSingleEntityPosition(entity, "y", event.target.value)} fullWidth />
      </Stack>
    );
  }

  function renderIslandPanels() {
    return (
      <>
        <Divider flexItem />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>编号方向</Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 0.5 }}>
          {ISLAND_SEQUENCE_DIRECTIONS.map((option) => (
            <Button
              key={option.value}
              size="small"
              variant={islandSequenceDirection === option.value ? "contained" : "outlined"}
              color="secondary"
              onClick={() => setIslandSequenceDirection(option.value)}
              aria-label={option.label}
              title={option.label}
              sx={{ minHeight: 34, height: 34, px: 0.75, fontSize: 22, lineHeight: 1, fontWeight: 700 }}
            >
              {option.symbol}
            </Button>
          ))}
        </Box>
        <TextField size="small" label="起始符号" value={islandSequenceStart} onChange={(event) => setIslandSequenceStart(event.target.value)} />
        <Button variant="contained" color="secondary" onClick={applyIslandSequenceLabels} disabled={selectedIslands.length < 2}>应用符号</Button>
        <Divider flexItem />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>展位编号</Typography>
        <FormControl size="small">
          <InputLabel id="island-numbering-corner-label">起始角</InputLabel>
          <Select labelId="island-numbering-corner-label" label="起始角" value={islandNumberingCorner} onChange={(event) => setIslandNumberingCorner(String(event.target.value || "top-left"))}>
            {ISLAND_NUMBERING_CORNERS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
          </Select>
        </FormControl>
        <TextField size="small" type="number" label="起始编号" value={islandNumberingStart} onChange={(event) => setIslandNumberingStart(event.target.value)} inputProps={{ min: 1, step: 1 }} />
        <FormControlLabel
          sx={{ my: -0.5 }}
          control={<Checkbox size="small" checked={islandNumberingPairMode} onChange={(event) => setIslandNumberingPairMode(event.target.checked)} />}
          label={<Typography variant="caption">每2格同号</Typography>}
        />
        <Button variant="contained" color="secondary" onClick={applyIslandBoothNumbering} disabled={!selectedIslands.length}>应用编号</Button>
        <Button variant="outlined" color="secondary" onClick={splitBoothsInSelectedIslands} disabled={!canSplitBoothsInSelectedIslands}>拆分 a/b</Button>
      </>
    );
  }

  function renderInspector() {
    if (!selectedPage || !graph) {
      return <Alert severity="info">未选择页面</Alert>;
    }
    if (!selectedEntities.length) {
      return <Alert severity="info">点击图形查看详情</Alert>;
    }
    if (selectedEntities.length > 1) {
      return (
        <>
          <Typography variant="body2" color="text.secondary">{selectedEntities.length} entities selected.</Typography>
          {renderTransformFields(selectedIds, selectedRect)}
          {addToTarget ? <Button variant="contained" color="secondary" onClick={addSelectedEntityToLarger}>Add to</Button> : null}
          {selectedAreOnlyIslands && selectedIslands.length > 1 ? renderIslandPanels() : null}
        </>
      );
    }

    const entity = selectedEntity;
    return (
      <>
        <Typography variant="body2" color="text.secondary">{entityLabel(entity)}</Typography>
        {renderSingleTransformFields(entity)}
        {entity.type === "booth" ? (
          <>
            <TextField size="small" label="展位号" value={entity.boothNumber || ""} onChange={(event) => updateEntityField(entity.id, "boothNumber", event.target.value)} />
            <FormControl size="small">
              <InputLabel id="booth-suffix-label">后缀</InputLabel>
              <Select labelId="booth-suffix-label" label="后缀" value={entity.boothSuffix || ""} onChange={(event) => updateEntityField(entity.id, "boothSuffix", event.target.value)}>
                {ALLOWED_BOOTH_SUFFIXES.map((suffix) => <MenuItem key={suffix || "none"} value={suffix}>{suffix || "无"}</MenuItem>)}
              </Select>
            </FormControl>
            <Stack direction="row" spacing={1}>
              <TextField size="small" label="W" type="number" value={entity.w} onChange={(event) => updateEntityField(entity.id, "w", event.target.value)} fullWidth />
              <TextField size="small" label="H" type="number" value={entity.h} onChange={(event) => updateEntityField(entity.id, "h", event.target.value)} fullWidth />
            </Stack>
          </>
        ) : null}
        {entity.type === "group" ? <TextField size="small" label="组ID" value={entity.id} InputProps={{ readOnly: true }} /> : null}
        {entity.type === "island" ? (
          <>
            <TextField size="small" label="岛标识" value={entity.raw || ""} onChange={(event) => updateEntityField(entity.id, "raw", event.target.value)} />
            {renderIslandPanels()}
          </>
        ) : null}
        {entity.type === "hall" ? (
          <>
            <TextField size="small" label="馆ID" value={entity.id} InputProps={{ readOnly: true }} />
            <TextField size="small" label="旋转" type="number" value={entity.rotation || 0} onChange={(event) => updateEntityField(entity.id, "rotation", event.target.value)} />
            <TextField size="small" label="缩放" type="number" value={entity.scale || 1} onChange={(event) => updateEntityField(entity.id, "scale", event.target.value)} inputProps={{ step: 0.01 }} />
            <TextField size="small" label="裁切" type="number" value={entity.trim || 0} onChange={(event) => updateEntityField(entity.id, "trim", event.target.value)} />
            <TextField size="small" label="背景图" value={entity.backgroundImagePath || ""} onChange={(event) => updateEntityField(entity.id, "backgroundImagePath", event.target.value)} />
            <Stack direction="row" spacing={1}>
              <TextField size="small" label="背景X" type="number" value={entity.backgroundOffsetX || 0} onChange={(event) => updateEntityField(entity.id, "backgroundOffsetX", event.target.value)} />
              <TextField size="small" label="背景Y" type="number" value={entity.backgroundOffsetY || 0} onChange={(event) => updateEntityField(entity.id, "backgroundOffsetY", event.target.value)} />
            </Stack>
          </>
        ) : null}
      </>
    );
  }

  const toolbarButtonSx = { minHeight: 32, height: 32, px: 1.25, py: 0.25, fontSize: 12, lineHeight: 1.2 };
  const toolbarControlSx = {
    minWidth: 180,
    "& .MuiInputBase-root": { minHeight: 32, height: 32, fontSize: 12 },
    "& .MuiInputLabel-root": { fontSize: 12 },
    "& .MuiSelect-select": { py: 0.5, minHeight: "20px" }
  };
  const toolbarRowSx = {
    alignItems: { xs: "stretch", md: "center" },
    "& .MuiButton-root": toolbarButtonSx,
    "& .MuiChip-root": { height: 24, fontSize: 12 },
    "& .MuiFormControlLabel-root": { m: 0, minHeight: 32 },
    "& .MuiFormControlLabel-label": { fontSize: 12, lineHeight: 1.2 },
    "& .MuiCheckbox-root": { p: 0.5 }
  };
  const inspectorSx = {
    "& .MuiStack-root": { rowGap: 0.75 },
    "& .MuiTextField-root .MuiInputBase-root": { minHeight: 32, height: 32, fontSize: 12 },
    "& .MuiTextField-root .MuiInputLabel-root": { fontSize: 12 },
    "& .MuiFormControl-root .MuiInputBase-root": { minHeight: 32, height: 32, fontSize: 12 },
    "& .MuiFormControl-root .MuiInputLabel-root": { fontSize: 12 },
    "& .MuiSelect-select": { py: 0.5, minHeight: "20px" },
    "& .MuiButton-root": { minHeight: 30, height: 30, px: 1, py: 0.25, fontSize: 12, lineHeight: 1.2 },
    "& .MuiTypography-body2": { fontSize: 12 },
    "& .MuiTypography-subtitle1": { fontSize: 14 },
    "& .MuiTypography-h6": { fontSize: 14 },
    "& .MuiFormControlLabel-root": { m: 0, minHeight: 28 },
    "& .MuiFormControlLabel-label": { fontSize: 12, lineHeight: 1.2 },
    "& .MuiCheckbox-root": { p: 0.5 }
  };

  return (
    <Box sx={{ minHeight: "100vh", pb: 6 }}>
      <Container maxWidth="xl" sx={{ pt: 1.5 }}>
        <Stack spacing={1.5}>
          {loading ? <Alert severity="info">加载地图数据中...</Alert> : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          {snapshotMessage ? <Alert severity="success">{snapshotMessage}</Alert> : null}
          {snapshotError ? <Alert severity="error">{snapshotError}</Alert> : null}

          <Paper elevation={0} sx={{ p: 1, border: "1px solid #eadbc7", borderRadius: 2 }}>
            <Stack spacing={0.75}>
              <Stack direction={{ xs: "column", md: "row" }} spacing={0.75} sx={toolbarRowSx}>
                <MapExtractionActions onRefresh={loadExtraction} />
                <Button variant="contained" color="secondary" size="small" onClick={validateLoadedMap} disabled={!pages.length || loading}>检查</Button>
                <Button variant="outlined" size="small" onClick={saveSnapshot} disabled={!pages.length || isSavingSnapshot || loading}>{isSavingSnapshot ? "保存中..." : "保存"}</Button>
                <Button variant="outlined" size="small" onClick={loadLatestSnapshot} disabled={isLoadingSnapshot || loading}>{isLoadingSnapshot ? "加载中..." : "加载"}</Button>
                <Button variant="outlined" size="small" color="warning" onClick={loadPreviousSnapshot} disabled={!loadedSnapshotId || isLoadingSnapshot || loading}>{isLoadingSnapshot ? "加载中..." : "回退"}</Button>
                <Button variant="text" size="small" onClick={resetView}>100%</Button>
                <FormControlLabel control={<Checkbox checked={showMapLabels} onChange={(event) => setShowMapLabels(event.target.checked)} size="small" />} label="显示标签" />
                <Box sx={{ flex: 1, display: { xs: "none", md: "block" } }} />
                <Button variant="contained" size="small" onClick={transferSnapshot} disabled={!pages.length || isSavingSnapshot || isTransferringSnapshot || loading}>{isTransferringSnapshot ? "Transferring..." : "转存"}</Button>
              </Stack>
              <Divider />
              <Stack direction={{ xs: "column", md: "row" }} spacing={0.75} sx={toolbarRowSx}>
                <FormControl size="small" sx={toolbarControlSx} disabled={!pages.length}>
                  <InputLabel id="map-page-select-label">页面</InputLabel>
                  <Select labelId="map-page-select-label" label="页面" value={selectedPageNumber} onChange={(event) => { setSelectedPageNumber(String(event.target.value || "")); setSelectedIds([]); }}>
                    {pages.map((page) => <MenuItem key={page.page} value={String(page.page)}>Page {page.page} ({page.entities.booths.length} booths)</MenuItem>)}
                  </Select>
                </FormControl>
                <Button variant="outlined" size="small" onClick={createNewPage} disabled={loading}>新建页</Button>
                <Button variant="outlined" color="error" size="small" onClick={requestDeleteCurrentPage} disabled={!selectedPage || loading}>删页</Button>
                <Box sx={{ flex: 1, display: { xs: "none", md: "block" } }} />
                <FormControl size="small" sx={toolbarControlSx} disabled={!pages.length}>
                  <InputLabel id="import-page-select-label">导入页</InputLabel>
                  <Select labelId="import-page-select-label" label="导入页" value={importSourcePageNumber} onChange={(event) => setImportSourcePageNumber(String(event.target.value || ""))}>
                    {pages.map((page) => <MenuItem key={`import-${page.page}`} value={String(page.page)}>Page {page.page} ({page.entities.booths.length} booths)</MenuItem>)}
                  </Select>
                </FormControl>
                <Button variant="outlined" size="small" onClick={importEntitiesFromPage} disabled={!selectedPage || !importSourcePageNumber || loading}>导入</Button>
                <Chip size="small" color="primary" label={`Zoom ${Math.round(zoom * 100)}%`} />
                {selectedPage ? <Chip size="small" variant="outlined" label={`Booths ${selectedPage.entities.booths.length}`} /> : null}
                {selectedPage ? <Chip size="small" variant="outlined" label={`Groups ${selectedPage.entities.groups.length}`} /> : null}
                {selectedPage ? <Chip size="small" variant="outlined" label={`Islands ${selectedPage.entities.islands.length}`} /> : null}
                {selectedPage ? <Chip size="small" variant="outlined" label={`Halls ${selectedPage.entities.halls.length}`} /> : null}
                {summary ? <Typography variant="body2" color="text.secondary">页数 {summary.pageCount} | 展位 {summary.totalBooths}</Typography> : null}
              </Stack>
              <Divider />
              <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ xs: "stretch", md: "center" }}>
                <Button variant="contained" color="secondary" onClick={fixMap} disabled={!selectedPage || loading}>修复地图</Button>
                <TextField
                  label="展位宽"
                  size="small"
                  type="number"
                  value={fixMapBoothSizeWidth}
                  onChange={(event) => setFixMapBoothSizeWidth(event.target.value)}
                  disabled={!selectedPage || loading}
                  slotProps={{ htmlInput: { min: 0, step: 0.1 } }}
                  sx={{ width: { xs: "100%", md: 120 } }}
                />
                <TextField
                  label="展位高"
                  size="small"
                  type="number"
                  value={fixMapBoothSizeHeight}
                  onChange={(event) => setFixMapBoothSizeHeight(event.target.value)}
                  disabled={!selectedPage || loading}
                  slotProps={{ htmlInput: { min: 0, step: 0.1 } }}
                  sx={{ width: { xs: "100%", md: 120 } }}
                />
                <TextField
                  label="展位偏移"
                  size="small"
                  type="number"
                  value={fixMapBoothSizeOffset}
                  onChange={(event) => setFixMapBoothSizeOffset(event.target.value)}
                  disabled={!selectedPage || loading}
                  slotProps={{ htmlInput: { step: 0.1 } }}
                  sx={{ width: { xs: "100%", md: 150 } }}
                />
                <Button variant="outlined" color="secondary" onClick={buildIslands} disabled={!selectedPage?.entities.groups.length || loading}>生成岛</Button>
                <Button variant="contained" color="secondary" onClick={mergeSelectedGroups} disabled={!canMergeSelectedGroups || loading}>合并组</Button>
                <Button variant="contained" color="secondary" onClick={mergeSelectedIslands} disabled={!canMergeSelectedIslands || loading}>合并岛</Button>
                <Button variant="outlined" color="secondary" onClick={createHallFromSelectedIslands} disabled={!canCreateHallFromSelectedIslands || loading}>生成馆</Button>
              </Stack>
            </Stack>
          </Paper>

          <Stack direction={{ xs: "column", lg: "row" }} spacing={1.5} alignItems="stretch">
            <Paper elevation={0} sx={{ p: 1.5, border: "1px solid #eadbc7", borderRadius: 3, flex: 1, minWidth: 0 }}>
              {selectedPage ? (
                <Box ref={viewportRef} onWheel={handleViewportWheel} onScroll={scheduleViewportMetricsRefresh} sx={{ overflow: "auto", borderRadius: 2, backgroundColor: "#f7f2ea", p: 1, height: { xs: "70vh", lg: "78vh" }, userSelect: "none", cursor: isSpacePanning ? "grab" : "default" }}>
                  <Box sx={{ position: "relative", display: "inline-block", lineHeight: 0, width: `${Math.max(canvasWorldRect.w * zoom, 1)}px`, height: `${Math.max(canvasWorldRect.h * zoom, 1)}px` }}>
                    <Box sx={{ position: "absolute", inset: 0, width: `${canvasWorldRect.w}px`, height: `${canvasWorldRect.h}px`, transform: `scale(${zoom})`, transformOrigin: "top left" }}>
                      {selectedPage.renderedImagePath ? <Box component="img" src={toImageUrl(selectedPage.renderedImagePath)} alt={`Map page ${selectedPage.page}`} onLoad={handleImageLoad} draggable={false} sx={{ position: "absolute", left: `${0 - canvasWorldRect.x}px`, top: `${0 - canvasWorldRect.y}px`, width: `${canvasSize.naturalWidth}px`, height: `${canvasSize.naturalHeight}px`, display: "block", pointerEvents: "none" }} /> : null}
                      {renderHallBackgrounds()}
                      <Box ref={canvasRef} component="canvas" onMouseDown={startCanvasInteraction} onContextMenu={handleCanvasContextMenu} sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "auto", cursor: isSpacePanning ? "grab" : "default" }} />
                    </Box>
                  </Box>
                </Box>
              ) : <Alert severity="info">未选择页面</Alert>}
            </Paper>

            <Box sx={{ width: { xs: "100%", lg: 320 }, flexShrink: 0 }}>
              <Paper elevation={0} sx={{ p: 1, border: "1px solid #eadbc7", borderRadius: 2, height: "100%", overflow: "auto", ...inspectorSx }}>
                <Stack spacing={0.75}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>选择</Typography>
                  {renderInspector()}
                  {selectedPage ? (
                    <>
                      <Typography variant="h6" sx={{ mt: 0.5 }}>页面摘要</Typography>
                      <Typography variant="body2">识别框：{selectedPage.boothRectangleCount}</Typography>
                      <Typography variant="body2">识别展位：{selectedPage.entities.booths.length}</Typography>
                      <Button variant="text" component="a" href={toImageUrl(selectedPage.debugImagePath)} target="_blank" rel="noreferrer">调试图</Button>
                    </>
                  ) : null}
                </Stack>
              </Paper>
            </Box>
          </Stack>
        </Stack>
      </Container>
      <Dialog open={isDeletePageDialogOpen} onClose={closeDeletePageDialog}>
        <DialogTitle>删除当前页？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            确认删除第 {selectedPage?.page || ""} 页？删除后需保存或转存才会生效。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDeletePageDialog}>取消</Button>
          <Button color="error" variant="contained" onClick={deleteCurrentPage}>删除</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
