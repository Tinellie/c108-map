import { useEffect, useMemo, useRef, useState } from "react";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import SaveIcon from "@mui/icons-material/Save";
import { Box, FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Stack, TextField, Tooltip, Typography } from "@mui/material";

const MAP_PAGES_API = import.meta.env.VITE_MAP_PAGES_API_URL || "http://127.0.0.1:3000/api/map/pages";
const MAPS_API = import.meta.env.VITE_MAPS_API_URL || "http://127.0.0.1:3000/api/maps";
const STORAGE_BASE_URL = import.meta.env.VITE_STORAGE_BASE_URL || "http://127.0.0.1:3000";
const GRID_WORLD_STEP = 100;
const HANDLE_WORLD_SIZE = 10;
const ROTATE_HANDLE_WORLD_OFFSET = 32;
const ENTITY_COLORS = {
  booth: { stroke: "rgba(0, 117, 190, 0.38)", fill: "rgba(0, 140, 255, 0.035)" },
  group: { stroke: "rgba(81, 168, 93, 0.9)", fill: "rgba(124, 208, 132, 0.07)" },
  island: { stroke: "rgba(176, 132, 255, 0.9)", fill: "rgba(196, 166, 255, 0.08)" },
  hall: { stroke: "rgba(242, 133, 49, 0.85)", fill: "rgba(252, 181, 112, 0.08)" }
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function readJson(response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.message || `Request failed (${response.status})`);
  }
  return json;
}

function degreesToRadians(degrees) {
  return Number(degrees || 0) * Math.PI / 180;
}

function radiansToDegrees(radians) {
  return radians * 180 / Math.PI;
}

function toScreenPoint(point, viewState) {
  return {
    x: point.x * viewState.zoom + viewState.offsetX,
    y: point.y * viewState.zoom + viewState.offsetY
  };
}

function toWorldPoint(point, viewState) {
  return {
    x: (point.x - viewState.offsetX) / viewState.zoom,
    y: (point.y - viewState.offsetY) / viewState.zoom
  };
}

function getObjectScale(object) {
  const scale = Number(object.transform.scale || 1);
  return Math.abs(scale) < 0.001 ? 1 : scale;
}

function getTransformCorners(transform) {
  const { x, y, w, h, rotation } = transform;
  const scale = Number(transform.scale || 1);
  const halfWidth = Number(w || 1) * scale / 2;
  const halfHeight = Number(h || 1) * scale / 2;
  const radians = degreesToRadians(rotation);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight }
  ].map((corner) => ({
    x: x + corner.x * cos - corner.y * sin,
    y: y + corner.x * sin + corner.y * cos
  }));
}

function getObjectCorners(object) {
  return getTransformCorners(object.worldTransform || object.transform);
}

function getObjectHandles(object) {
  const transform = object.worldTransform || object.transform;
  const corners = getTransformCorners(transform);
  const topMid = {
    x: (corners[0].x + corners[1].x) / 2,
    y: (corners[0].y + corners[1].y) / 2
  };
  const center = { x: transform.x, y: transform.y };
  const dx = topMid.x - center.x;
  const dy = topMid.y - center.y;
  const length = Math.max(0.001, Math.hypot(dx, dy));
  return {
    scale: corners[2],
    rotate: {
      x: topMid.x + dx / length * ROTATE_HANDLE_WORLD_OFFSET,
      y: topMid.y + dy / length * ROTATE_HANDLE_WORLD_OFFSET
    }
  };
}

function pointToObjectLocal(point, object) {
  const transform = object.worldTransform || object.transform;
  const scale = Number(transform.scale || 1);
  const radians = degreesToRadians(transform.rotation);
  const cos = Math.cos(-radians);
  const sin = Math.sin(-radians);
  const dx = point.x - transform.x;
  const dy = point.y - transform.y;
  return {
    x: (dx * cos - dy * sin) / scale,
    y: (dx * sin + dy * cos) / scale
  };
}

function isPointInObject(point, object) {
  const local = pointToObjectLocal(point, object);
  return Math.abs(local.x) <= Number(object.transform.w || 1) / 2 && Math.abs(local.y) <= Number(object.transform.h || 1) / 2;
}

function isNearPoint(point, target, radius) {
  return Math.hypot(point.x - target.x, point.y - target.y) <= radius;
}

function cloneObjects(objects) {
  return objects.map((object) => ({
    ...object,
    metadata: object.metadata ? { ...object.metadata } : undefined,
    transform: { ...object.transform }
  }));
}

function rectFromPoints(points) {
  if (!points.length) {
    return null;
  }
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    x: minX,
    y: minY,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY)
  };
}

function normalizeRect(rect) {
  const left = Math.min(rect.startX, rect.endX);
  const right = Math.max(rect.startX, rect.endX);
  const top = Math.min(rect.startY, rect.endY);
  const bottom = Math.max(rect.startY, rect.endY);
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

function rectsIntersect(leftRect, rightRect) {
  return leftRect.left <= rightRect.right && leftRect.right >= rightRect.left && leftRect.top <= rightRect.bottom && leftRect.bottom >= rightRect.top;
}

function createImageObject(file, imageUrl, image) {
  return {
    id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "image",
    name: file.name || "Image",
    imageUrl,
    imagePath: "",
    parentId: "",
    metadata: {
      fileName: file.name || "image",
      mimeType: file.type || "application/octet-stream",
      isNewUpload: true
    },
    transform: {
      x: 0,
      y: 0,
      w: image.naturalWidth || 240,
      h: image.naturalHeight || 160,
      rotation: 0,
      scale: 1,
      z: Date.now()
    }
  };
}

function transformLocalPoint(parentTransform, point) {
  const parentScale = Number(parentTransform.scale || 1);
  const radians = degreesToRadians(parentTransform.rotation);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const scaledX = point.x * parentScale;
  const scaledY = point.y * parentScale;
  return {
    x: parentTransform.x + scaledX * cos - scaledY * sin,
    y: parentTransform.y + scaledX * sin + scaledY * cos
  };
}

function inverseTransformVector(parentTransform, vector) {
  const parentScale = Number(parentTransform.scale || 1);
  const radians = degreesToRadians(parentTransform.rotation);
  const cos = Math.cos(-radians);
  const sin = Math.sin(-radians);
  return {
    x: (vector.x * cos - vector.y * sin) / parentScale,
    y: (vector.x * sin + vector.y * cos) / parentScale
  };
}

function buildWorldObjects(objects) {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const cache = new Map();

  function resolve(object) {
    if (cache.has(object.id)) {
      return cache.get(object.id);
    }
    const parent = object.parentId ? byId.get(object.parentId) : null;
    if (!parent) {
      const resolved = { ...object, worldTransform: { ...object.transform } };
      cache.set(object.id, resolved);
      return resolved;
    }
    const resolvedParent = resolve(parent);
    const worldPoint = transformLocalPoint(resolvedParent.worldTransform, object.transform);
    const resolved = {
      ...object,
      worldTransform: {
        ...object.transform,
        x: worldPoint.x,
        y: worldPoint.y,
        rotation: Number(resolvedParent.worldTransform.rotation || 0) + Number(object.transform.rotation || 0),
        scale: Number(resolvedParent.worldTransform.scale || 1) * Number(object.transform.scale || 1)
      }
    };
    cache.set(object.id, resolved);
    return resolved;
  }

  return objects.map(resolve);
}

function createImportedEntityObject(entity, type, index) {
  const width = type === "booth" ? Number(entity.w || 1) : 1;
  const height = type === "booth" ? Number(entity.h || 1) : 1;
  return {
    id: String(entity.id || `${type}-${index}`),
    type,
    name: type === "booth" ? `${entity.boothNumber || ""}${entity.boothSuffix || ""}`.trim() || entity.id : String(entity.raw || entity.id || type),
    parentId: String(entity.parentId || ""),
    metadata: {
      boothNumber: entity.boothNumber || "",
      boothSuffix: entity.boothSuffix || "",
      splitIndex: entity.splitIndex || 0,
      raw: entity.raw || ""
    },
    transform: {
      x: Number(entity.x || 0) + (type === "booth" ? width / 2 : 0),
      y: Number(entity.y || 0) + (type === "booth" ? height / 2 : 0),
      w: width,
      h: height,
      rotation: Number(entity.rotation || 0),
      scale: 1,
      z: index
    }
  };
}

function fitParentBoundariesToChildren(objects) {
  let nextObjects = objects;
  ["group", "island", "hall"].forEach((type) => {
    const previousObjects = nextObjects;
    const worldObjects = buildWorldObjects(previousObjects);
    const worldById = new Map(worldObjects.map((object) => [object.id, object]));
    const adjustedObjects = previousObjects.map((parent) => {
      if (parent.type !== type) {
        return parent;
      }

      const childCorners = worldObjects
        .filter((object) => object.parentId === parent.id)
        .flatMap(getObjectCorners);
      const childRect = rectFromPoints(childCorners);
      const worldParent = worldById.get(parent.id);
      if (!childRect || !worldParent) {
        return parent;
      }

      const nextWorldCenter = {
        x: childRect.x + childRect.w / 2,
        y: childRect.y + childRect.h / 2
      };
      const worldDelta = {
        x: nextWorldCenter.x - worldParent.worldTransform.x,
        y: nextWorldCenter.y - worldParent.worldTransform.y
      };
      const localDelta = parent.parentId && worldById.has(parent.parentId)
        ? inverseTransformVector(worldById.get(parent.parentId).worldTransform, worldDelta)
        : worldDelta;

      return {
        ...parent,
        transform: {
          ...parent.transform,
          x: parent.transform.x + localDelta.x,
          y: parent.transform.y + localDelta.y,
          w: childRect.w / Math.max(0.001, Number(worldParent.worldTransform.scale || 1)),
          h: childRect.h / Math.max(0.001, Number(worldParent.worldTransform.scale || 1))
        }
      };
    });

    const adjustedParents = new Map(adjustedObjects.filter((object) => object.type === type).map((object) => [object.id, object]));
    nextObjects = adjustedObjects.map((object) => {
      const adjustedParent = adjustedParents.get(object.parentId);
      const originalParent = previousObjects.find((candidate) => candidate.id === object.parentId && candidate.type === type);
      if (!adjustedParent || !originalParent) {
        return object;
      }
      return {
        ...object,
        transform: {
          ...object.transform,
          x: object.transform.x - (adjustedParent.transform.x - originalParent.transform.x),
          y: object.transform.y - (adjustedParent.transform.y - originalParent.transform.y)
        }
      };
    });
  });
  return nextObjects;
}

function createObjectsFromMapPage(page) {
  const entities = page?.entities || {};
  const imported = [
    ...(entities.halls || []).map((entity, index) => createImportedEntityObject(entity, "hall", index)),
    ...(entities.islands || []).map((entity, index) => createImportedEntityObject(entity, "island", 10000 + index)),
    ...(entities.groups || []).map((entity, index) => createImportedEntityObject(entity, "group", 20000 + index)),
    ...(entities.booths || []).map((entity, index) => createImportedEntityObject(entity, "booth", 30000 + index))
  ];
  const existingIds = new Set(imported.map((object) => object.id));
  const withValidParents = fitParentBoundariesToChildren(imported.map((object) => existingIds.has(object.parentId) ? object : { ...object, parentId: "" }));
  const worldObjects = buildWorldObjects(withValidParents);
  const boothCorners = worldObjects.filter((object) => object.type === "booth").flatMap(getObjectCorners);
  if (!boothCorners.length) {
    return withValidParents;
  }
  const minX = Math.min(...boothCorners.map((point) => point.x));
  const maxX = Math.max(...boothCorners.map((point) => point.x));
  const minY = Math.min(...boothCorners.map((point) => point.y));
  const maxY = Math.max(...boothCorners.map((point) => point.y));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return withValidParents.map((object) => object.parentId ? object : {
    ...object,
    transform: { ...object.transform, x: object.transform.x - centerX, y: object.transform.y - centerY }
  });
}

function namespaceImportedObjects(importedObjects, currentObjects, namespace) {
  const usedIds = new Set(currentObjects.map((object) => object.id));
  const idMap = new Map();

  importedObjects.forEach((object, index) => {
    const baseId = `${namespace}-${object.id}`;
    let nextId = baseId;
    let suffix = 1;
    while (usedIds.has(nextId)) {
      nextId = `${baseId}-${index}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(nextId);
    idMap.set(object.id, nextId);
  });

  const maxZ = currentObjects.reduce((max, object) => Math.max(max, Number(object.transform?.z || 0)), 0);
  return importedObjects.map((object) => ({
    ...object,
    id: idMap.get(object.id),
    parentId: object.parentId ? idMap.get(object.parentId) || "" : "",
    metadata: {
      ...(object.metadata || {}),
      originalId: object.id
    },
    transform: {
      ...object.transform,
      z: maxZ + Number(object.transform.z || 0) + 1
    }
  }));
}

function toImageUrl(imagePath) {
  if (!imagePath) {
    return "";
  }
  if (String(imagePath).startsWith("http") || String(imagePath).startsWith("blob:")) {
    return String(imagePath);
  }
  return `${STORAGE_BASE_URL.replace(/\/$/, "")}/${String(imagePath).replace(/^\//, "")}`;
}

function createObjectsFromSavedMap(savedMap) {
  return (Array.isArray(savedMap?.objects) ? savedMap.objects : []).map((object) => ({
    id: String(object?.id || ""),
    type: String(object?.type || ""),
    name: String(object?.name || ""),
    parentId: String(object?.parentId || ""),
    imagePath: String(object?.imagePath || ""),
    imageUrl: object?.type === "image" ? toImageUrl(object?.imagePath || object?.imageUrl || "") : "",
    metadata: object?.metadata && typeof object.metadata === "object" ? object.metadata : {},
    transform: object?.transform && typeof object.transform === "object" ? { ...object.transform } : { x: 0, y: 0, w: 1, h: 1, rotation: 0, scale: 1, z: 0 }
  })).filter((object) => object.id);
}

export function MapPage() {
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const frameRef = useRef(0);
  const imageCacheRef = useRef(new Map());
  const objectUrlsRef = useRef([]);
  const imageFilesRef = useRef(new Map());
  const objectsRef = useRef([]);
  const selectedObjectIdRef = useRef("");
  const selectedObjectIdsRef = useRef([]);
  const undoStackRef = useRef([]);
  const dragStateRef = useRef({ type: "none", pointerId: null, lastX: 0, lastY: 0 });
  const hasCenteredOriginRef = useRef(false);

  const [objects, setObjects] = useState([]);
  const [mapPages, setMapPages] = useState([]);
  const [selectedMapPage, setSelectedMapPage] = useState("");
  const [selectedObjectId, setSelectedObjectId] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [isSavingMap, setIsSavingMap] = useState(false);
  const [isLoadingMap, setIsLoadingMap] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [renderTick, setRenderTick] = useState(0);
  const [viewState, setViewState] = useState({ zoom: 1, offsetX: 0, offsetY: 0 });
  const [selectedObjectIds, setSelectedObjectIds] = useState([]);
  const [selectionRect, setSelectionRect] = useState(null);

  const selectedObject = useMemo(
    () => objects.find((object) => object.id === selectedObjectId) || null,
    [objects, selectedObjectId]
  );
  const worldObjects = useMemo(() => buildWorldObjects(objects), [objects]);
  const worldSelectedObject = useMemo(
    () => worldObjects.find((object) => object.id === selectedObjectId) || null,
    [worldObjects, selectedObjectId]
  );
  const selectedObjectIdSet = useMemo(() => new Set(selectedObjectIds), [selectedObjectIds]);

  const canvasCursor = useMemo(() => {
    if (isPanning) {
      return "grabbing";
    }
    return isSpacePressed ? "grab" : "default";
  }, [isPanning, isSpacePressed]);

  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  useEffect(() => {
    selectedObjectIdRef.current = selectedObjectId;
  }, [selectedObjectId]);

  useEffect(() => {
    selectedObjectIdsRef.current = selectedObjectIds;
  }, [selectedObjectIds]);

  useEffect(() => {
    let isMounted = true;
    async function loadMapPages() {
      try {
        const response = await fetch(MAP_PAGES_API);
        const json = await readJson(response);
        const nextPages = Array.isArray(json.data) ? json.data : [];
        if (!isMounted) {
          return;
        }
        setMapPages(nextPages);
        setSelectedMapPage(nextPages[0] ? String(nextPages[0].page) : "");
      } catch (error) {
        if (isMounted) {
          setImportStatus(error.message || "Failed to load map pages");
        }
      }
    }
    loadMapPages();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      const isUndoShortcut = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z";
      if (isUndoShortcut) {
        event.preventDefault();
        undoLastObjectChange();
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && selectedObjectIdsRef.current.length) {
        const activeElement = document.activeElement;
        const isEditingInput = ["INPUT", "TEXTAREA", "SELECT"].includes(activeElement?.tagName || "") || Boolean(activeElement?.isContentEditable);
        if (!isEditingInput) {
          event.preventDefault();
          deleteSelectedObjects();
          return;
        }
      }

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
      dragStateRef.current.type = "none";
      dragStateRef.current.pointerId = null;
      setSelectionRect(null);
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

      context.fillStyle = "#f8f7f4";
      context.fillRect(0, 0, width, height);

      const originX = viewState.offsetX;
      const originY = viewState.offsetY;
      const leftWorld = (0 - viewState.offsetX) / viewState.zoom;
      const rightWorld = (width - viewState.offsetX) / viewState.zoom;
      const topWorld = (0 - viewState.offsetY) / viewState.zoom;
      const bottomWorld = (height - viewState.offsetY) / viewState.zoom;
      const firstGridX = Math.floor(leftWorld / GRID_WORLD_STEP) * GRID_WORLD_STEP;
      const lastGridX = Math.ceil(rightWorld / GRID_WORLD_STEP) * GRID_WORLD_STEP;
      const firstGridY = Math.floor(topWorld / GRID_WORLD_STEP) * GRID_WORLD_STEP;
      const lastGridY = Math.ceil(bottomWorld / GRID_WORLD_STEP) * GRID_WORLD_STEP;

      context.strokeStyle = "rgba(120, 120, 120, 0.16)";
      context.lineWidth = 1;
      context.beginPath();
      for (let worldX = firstGridX; worldX <= lastGridX; worldX += GRID_WORLD_STEP) {
        if (worldX === 0) {
          continue;
        }
        const screenX = worldX * viewState.zoom + viewState.offsetX;
        context.moveTo(screenX, 0);
        context.lineTo(screenX, height);
      }
      for (let worldY = firstGridY; worldY <= lastGridY; worldY += GRID_WORLD_STEP) {
        if (worldY === 0) {
          continue;
        }
        const screenY = worldY * viewState.zoom + viewState.offsetY;
        context.moveTo(0, screenY);
        context.lineTo(width, screenY);
      }
      context.stroke();

      context.strokeStyle = "rgba(118, 118, 118, 0.85)";
      context.lineWidth = 1.25;
      context.beginPath();
      context.moveTo(0, originY);
      context.lineTo(width, originY);
      context.moveTo(originX, 0);
      context.lineTo(originX, height);
      context.stroke();

      context.fillStyle = "rgba(80, 80, 80, 0.9)";
      context.font = "12px monospace";
      context.fillText("0,0", originX + 8, originY - 8);

      const sortedObjects = [...worldObjects].sort((left, right) => Number(left.transform.z || 0) - Number(right.transform.z || 0));
      sortedObjects.forEach((object) => {
        const transform = object.worldTransform || object.transform;
        context.save();
        context.translate(transform.x * viewState.zoom + viewState.offsetX, transform.y * viewState.zoom + viewState.offsetY);
        context.rotate(degreesToRadians(transform.rotation));
        context.scale(Number(transform.scale || 1) * viewState.zoom, Number(transform.scale || 1) * viewState.zoom);
        if (object.type === "image") {
          let image = imageCacheRef.current.get(object.id);
          if (!image) {
            image = new Image();
            image.onload = () => setRenderTick((current) => current + 1);
            image.onerror = () => setSaveStatus(`Failed to load image ${object.imagePath || object.name || object.id}`);
            image.src = object.imageUrl;
            imageCacheRef.current.set(object.id, image);
          }
          if (image.complete && image.naturalWidth > 0) {
            context.drawImage(image, -transform.w / 2, -transform.h / 2, transform.w, transform.h);
          }
        } else {
          const colors = ENTITY_COLORS[object.type] || ENTITY_COLORS.booth;
          context.fillStyle = colors.fill;
          context.strokeStyle = colors.stroke;
          context.lineWidth = 1 / Math.max(0.1, Number(transform.scale || 1) * viewState.zoom);
          context.fillRect(-transform.w / 2, -transform.h / 2, transform.w, transform.h);
          context.strokeRect(-transform.w / 2, -transform.h / 2, transform.w, transform.h);
        }
        context.restore();
      });

      worldObjects.filter((object) => selectedObjectIdSet.has(object.id)).forEach((object) => {
        const corners = getObjectCorners(object).map((corner) => toScreenPoint(corner, viewState));
        context.strokeStyle = object.id === selectedObjectId ? "rgba(0, 104, 180, 0.95)" : "rgba(0, 104, 180, 0.45)";
        context.lineWidth = object.id === selectedObjectId ? 1.5 : 1;
        context.beginPath();
        context.moveTo(corners[0].x, corners[0].y);
        corners.slice(1).forEach((corner) => context.lineTo(corner.x, corner.y));
        context.closePath();
        context.stroke();
      });

      const selected = worldObjects.find((object) => object.id === selectedObjectId);
      if (selected) {
        const corners = getObjectCorners(selected).map((corner) => toScreenPoint(corner, viewState));
        const handles = getObjectHandles(selected);
        const scaleHandle = toScreenPoint(handles.scale, viewState);
        const rotateHandle = toScreenPoint(handles.rotate, viewState);

        context.strokeStyle = "rgba(0, 104, 180, 0.65)";
        context.beginPath();
        context.moveTo((corners[0].x + corners[1].x) / 2, (corners[0].y + corners[1].y) / 2);
        context.lineTo(rotateHandle.x, rotateHandle.y);
        context.stroke();

        context.fillStyle = "#ffffff";
        context.strokeStyle = "rgba(0, 104, 180, 0.95)";
        [scaleHandle, rotateHandle].forEach((handle) => {
          context.beginPath();
          context.rect(handle.x - 5, handle.y - 5, 10, 10);
          context.fill();
          context.stroke();
        });
      }

      if (selectionRect) {
        const rect = normalizeRect(selectionRect);
        context.fillStyle = "rgba(0, 104, 180, 0.08)";
        context.strokeStyle = "rgba(0, 104, 180, 0.75)";
        context.lineWidth = 1;
        context.setLineDash([5, 4]);
        context.fillRect(rect.left, rect.top, rect.width, rect.height);
        context.strokeRect(rect.left, rect.top, rect.width, rect.height);
        context.setLineDash([]);
      }

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
  }, [viewState, worldObjects, selectedObjectId, selectedObjectIdSet, selectionRect, renderTick]);

  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((imageUrl) => URL.revokeObjectURL(imageUrl));
    };
  }, []);

  function getCanvasPoint(event) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function updateSelectedObjectTransform(field, value) {
    commitObjectsChange((current) => current.map((object) => object.id === selectedObjectId ? {
      ...object,
      transform: {
        ...object.transform,
        [field]: Number(value)
      }
    } : object));
  }

  function setObjectSelection(ids, primaryId) {
    const existingIds = new Set(objectsRef.current.map((object) => object.id));
    const uniqueIds = [...new Set(ids)].filter((id) => existingIds.has(id));
    const nextPrimaryId = primaryId && uniqueIds.includes(primaryId) ? primaryId : uniqueIds[uniqueIds.length - 1] || "";
    setSelectedObjectIds(uniqueIds);
    setSelectedObjectId(nextPrimaryId);
  }

  function toggleObjectSelection(objectId) {
    const isSelected = selectedObjectIdsRef.current.includes(objectId);
    const nextIds = isSelected ? selectedObjectIdsRef.current.filter((id) => id !== objectId) : [...selectedObjectIdsRef.current, objectId];
    setObjectSelection(nextIds, isSelected ? nextIds[nextIds.length - 1] || "" : objectId);
  }

  function deleteSelectedObjects() {
    const idsToDelete = new Set(selectedObjectIdsRef.current);
    if (!idsToDelete.size) {
      return;
    }
    let foundDescendant = true;
    while (foundDescendant) {
      foundDescendant = false;
      objectsRef.current.forEach((object) => {
        if (!idsToDelete.has(object.id) && idsToDelete.has(object.parentId)) {
          idsToDelete.add(object.id);
          foundDescendant = true;
        }
      });
    }
    commitObjectsChange(
      (current) => current.filter((object) => !idsToDelete.has(object.id)),
      "",
      []
    );
    setImportStatus(`Deleted ${idsToDelete.size} object${idsToDelete.size === 1 ? "" : "s"}`);
  }

  function pushUndoSnapshot() {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-99),
      {
        objects: cloneObjects(objectsRef.current),
        selectedObjectId: selectedObjectIdRef.current,
        selectedObjectIds: selectedObjectIdsRef.current
      }
    ];
  }

  function commitObjectsChange(updater, nextSelectedObjectId, nextSelectedObjectIds) {
    pushUndoSnapshot();
    setObjects((current) => typeof updater === "function" ? updater(current) : updater);
    if (nextSelectedObjectId !== undefined) {
      setSelectedObjectId(nextSelectedObjectId);
      setSelectedObjectIds(nextSelectedObjectIds !== undefined ? nextSelectedObjectIds : (nextSelectedObjectId ? [nextSelectedObjectId] : []));
    }
  }

  function undoLastObjectChange() {
    const previous = undoStackRef.current.pop();
    if (!previous) {
      return;
    }
    dragStateRef.current = { type: "none", pointerId: null, lastX: 0, lastY: 0 };
    setIsPanning(false);
    setObjects(previous.objects);
    setSelectedObjectId(previous.selectedObjectId);
    setSelectedObjectIds(previous.selectedObjectIds || (previous.selectedObjectId ? [previous.selectedObjectId] : []));
    setSelectionRect(null);
    setImportStatus("Undid last change");
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  }

  function serializeObjectForSave(object) {
    return {
      id: object.id,
      type: object.type,
      name: object.name || "",
      parentId: object.parentId || "",
      imagePath: object.imagePath || "",
      metadata: object.metadata || {},
      transform: { ...object.transform }
    };
  }

  async function handleSaveMap() {
    setIsSavingMap(true);
    setSaveStatus("Saving...");
    try {
      const assets = [];
      for (const object of objectsRef.current) {
        const file = imageFilesRef.current.get(object.id);
        if (!file) {
          continue;
        }
        assets.push({
          objectId: object.id,
          fileName: file.name || object.metadata?.fileName || "image",
          dataUrl: await fileToDataUrl(file)
        });
      }

      const response = await fetch(MAPS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objects: objectsRef.current.map(serializeObjectForSave), assets })
      });
      const json = await readJson(response);
      const savedObjects = Array.isArray(json.data?.objects) ? json.data.objects : [];
      const imagePathByObjectId = new Map(savedObjects.map((object) => [object.id, object.imagePath]).filter((entry) => Boolean(entry[1])));
      if (imagePathByObjectId.size) {
        setObjects((current) => current.map((object) => imagePathByObjectId.has(object.id) ? {
          ...object,
          imagePath: imagePathByObjectId.get(object.id),
          metadata: { ...(object.metadata || {}), isNewUpload: false }
        } : object));
        imagePathByObjectId.forEach((_imagePath, objectId) => imageFilesRef.current.delete(objectId));
      }
      setSaveStatus(`Saved ${json.data?.objectCount || objectsRef.current.length} objects to ${json.data?.path || "storage/maps"}`);
    } catch (error) {
      setSaveStatus(error.message || "Failed to save map");
    } finally {
      setIsSavingMap(false);
    }
  }

  async function handleLoadLatestMap() {
    setIsLoadingMap(true);
    setSaveStatus("Loading latest save...");
    try {
      const response = await fetch(`${MAPS_API}/latest`);
      const json = await readJson(response);
      const loadedObjects = createObjectsFromSavedMap(json.data);
      imageFilesRef.current.clear();
      imageCacheRef.current.clear();
      commitObjectsChange(loadedObjects, loadedObjects[0]?.id || "");
      setSaveStatus(`Loaded ${loadedObjects.length} objects from ${json.data?.path || "latest save"}`);
    } catch (error) {
      setSaveStatus(error.message || "Failed to load latest map");
    } finally {
      setIsLoadingMap(false);
    }
  }

  async function handleImportMapPage() {
    if (!selectedMapPage) {
      return;
    }
    setImportStatus("Importing...");
    try {
      const response = await fetch(`${MAP_PAGES_API}/${encodeURIComponent(selectedMapPage)}`);
      const json = await readJson(response);
      const importedObjects = createObjectsFromMapPage(json.data);
      const namespace = `map-page-${selectedMapPage}-${Date.now()}`;
      const namespacedObjects = namespaceImportedObjects(importedObjects, objectsRef.current, namespace);
      commitObjectsChange((current) => [...current, ...namespacedObjects], namespacedObjects[0]?.id || "");
      setImportStatus(`Imported Page ${selectedMapPage}: ${importedObjects.length} entities`);
    } catch (error) {
      setImportStatus(error.message || "Failed to import map page");
    }
  }

  function handleLoadImageClick() {
    fileInputRef.current?.click();
  }

  function handleImageFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    const imageUrl = URL.createObjectURL(file);
    objectUrlsRef.current.push(imageUrl);
    const image = new Image();
    image.onload = () => {
      const object = createImageObject(file, imageUrl, image);
      imageCacheRef.current.set(object.id, image);
      imageFilesRef.current.set(object.id, file);
      commitObjectsChange((current) => [...current, object], object.id);
    };
    image.src = imageUrl;
  }

  function handlePointerDown(event) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const canvasPoint = getCanvasPoint(event);
    if (!canvasPoint) {
      return;
    }
    const worldPoint = toWorldPoint(canvasPoint, viewState);

    if (isSpacePressed) {
      dragStateRef.current = { type: "pan", pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
      setIsPanning(true);
      if (canvasRef.current) {
        canvasRef.current.setPointerCapture(event.pointerId);
      }
      return;
    }

    const handleRadius = HANDLE_WORLD_SIZE / viewState.zoom + 4;
    if (worldSelectedObject) {
      const handles = getObjectHandles(worldSelectedObject);
      if (isNearPoint(worldPoint, handles.rotate, handleRadius)) {
        pushUndoSnapshot();
        dragStateRef.current = { type: "rotate", pointerId: event.pointerId, objectId: worldSelectedObject.id };
        canvasRef.current?.setPointerCapture(event.pointerId);
        return;
      }
      if (isNearPoint(worldPoint, handles.scale, handleRadius)) {
        pushUndoSnapshot();
        dragStateRef.current = { type: "scale", pointerId: event.pointerId, objectId: worldSelectedObject.id, startDistance: Math.max(1, Math.hypot(worldPoint.x - worldSelectedObject.worldTransform.x, worldPoint.y - worldSelectedObject.worldTransform.y)), startScale: getObjectScale(selectedObject) };
        canvasRef.current?.setPointerCapture(event.pointerId);
        return;
      }
    }

    const hitObject = [...worldObjects]
      .sort((left, right) => Number(right.transform.z || 0) - Number(left.transform.z || 0))
      .find((object) => isPointInObject(worldPoint, object));
    if (hitObject) {
      if (event.shiftKey) {
        toggleObjectSelection(hitObject.id);
        dragStateRef.current = { type: "none", pointerId: null, lastX: 0, lastY: 0 };
        return;
      }
      const nextSelectionIds = selectedObjectIdsRef.current.includes(hitObject.id) ? selectedObjectIdsRef.current : [hitObject.id];
      setObjectSelection(nextSelectionIds, hitObject.id);
      pushUndoSnapshot();
      dragStateRef.current = { type: "object", pointerId: event.pointerId, objectIds: nextSelectionIds, lastWorldX: worldPoint.x, lastWorldY: worldPoint.y };
      canvasRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    dragStateRef.current = { type: "select", pointerId: event.pointerId, shiftKey: event.shiftKey, startX: canvasPoint.x, startY: canvasPoint.y, endX: canvasPoint.x, endY: canvasPoint.y };
    setSelectionRect({ startX: canvasPoint.x, startY: canvasPoint.y, endX: canvasPoint.x, endY: canvasPoint.y });
    canvasRef.current?.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event) {
    if (dragStateRef.current.type === "none" || dragStateRef.current.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();

    if (dragStateRef.current.type === "pan") {
      const dx = event.clientX - dragStateRef.current.lastX;
      const dy = event.clientY - dragStateRef.current.lastY;
      dragStateRef.current.lastX = event.clientX;
      dragStateRef.current.lastY = event.clientY;
      setViewState((current) => ({
        ...current,
        offsetX: current.offsetX + dx,
        offsetY: current.offsetY + dy
      }));
      return;
    }

    const canvasPoint = getCanvasPoint(event);
    if (!canvasPoint) {
      return;
    }
    const worldPoint = toWorldPoint(canvasPoint, viewState);

    if (dragStateRef.current.type === "object") {
      const dx = worldPoint.x - dragStateRef.current.lastWorldX;
      const dy = worldPoint.y - dragStateRef.current.lastWorldY;
      dragStateRef.current.lastWorldX = worldPoint.x;
      dragStateRef.current.lastWorldY = worldPoint.y;
      const movingIds = new Set(dragStateRef.current.objectIds || [dragStateRef.current.objectId]);
      setObjects((current) => current.map((object) => movingIds.has(object.id) ? {
        ...object,
        transform: { ...object.transform, ...(() => {
          const worldParent = buildWorldObjects(current).find((candidate) => candidate.id === object.parentId);
          const localDelta = worldParent ? inverseTransformVector(worldParent.worldTransform, { x: dx, y: dy }) : { x: dx, y: dy };
          return { x: object.transform.x + localDelta.x, y: object.transform.y + localDelta.y };
        })() }
      } : object));
      return;
    }

    if (dragStateRef.current.type === "select") {
      dragStateRef.current.endX = canvasPoint.x;
      dragStateRef.current.endY = canvasPoint.y;
      setSelectionRect({
        startX: dragStateRef.current.startX,
        startY: dragStateRef.current.startY,
        endX: canvasPoint.x,
        endY: canvasPoint.y
      });
      return;
    }

    if (dragStateRef.current.type === "scale") {
      setObjects((current) => current.map((object) => {
        if (object.id !== dragStateRef.current.objectId) {
          return object;
        }
        const worldObject = buildWorldObjects(current).find((candidate) => candidate.id === object.id) || object;
        const distance = Math.max(1, Math.hypot(worldPoint.x - worldObject.worldTransform.x, worldPoint.y - worldObject.worldTransform.y));
        return {
          ...object,
          transform: { ...object.transform, scale: clamp(dragStateRef.current.startScale * distance / dragStateRef.current.startDistance, 0.05, 20) }
        };
      }));
      return;
    }

    if (dragStateRef.current.type === "rotate") {
      setObjects((current) => current.map((object) => object.id === dragStateRef.current.objectId ? {
        ...object,
        transform: { ...object.transform, rotation: radiansToDegrees(Math.atan2(worldPoint.y - (worldObjects.find((candidate) => candidate.id === object.id)?.worldTransform.y || object.transform.y), worldPoint.x - (worldObjects.find((candidate) => candidate.id === object.id)?.worldTransform.x || object.transform.x))) + 90 }
      } : object));
    }
  }

  function endPointerPan(pointerId) {
    if (dragStateRef.current.type === "none" || dragStateRef.current.pointerId !== pointerId) {
      return;
    }
    if (dragStateRef.current.type === "select") {
      const rect = normalizeRect(dragStateRef.current);
      const selectedByRect = worldObjects.filter((object) => {
        const screenCorners = getObjectCorners(object).map((point) => toScreenPoint(point, viewState));
        const objectRect = normalizeRect({
          startX: Math.min(...screenCorners.map((point) => point.x)),
          startY: Math.min(...screenCorners.map((point) => point.y)),
          endX: Math.max(...screenCorners.map((point) => point.x)),
          endY: Math.max(...screenCorners.map((point) => point.y))
        });
        return rectsIntersect(rect, objectRect);
      }).map((object) => object.id);
      const nextIds = dragStateRef.current.shiftKey
        ? [...selectedObjectIdsRef.current.filter((id) => !selectedByRect.includes(id)), ...selectedByRect.filter((id) => !selectedObjectIdsRef.current.includes(id))]
        : selectedByRect;
      setObjectSelection(nextIds, nextIds[nextIds.length - 1] || "");
      setSelectionRect(null);
    }
    dragStateRef.current.type = "none";
    dragStateRef.current.pointerId = null;
    setIsPanning(false);
  }

  function handlePointerUp(event) {
    endPointerPan(event.pointerId);
  }

  function handlePointerCancel(event) {
    endPointerPan(event.pointerId);
  }

  function handleWheel(event) {
    event.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;

    setViewState((current) => {
      const nextZoom = clamp(current.zoom * Math.exp(-event.deltaY * 0.0015), 0.03, 40);
      const worldX = (localX - current.offsetX) / current.zoom;
      const worldY = (localY - current.offsetY) / current.zoom;
      return {
        zoom: nextZoom,
        offsetX: localX - worldX * nextZoom,
        offsetY: localY - worldY * nextZoom
      };
    });
  }

  return (
    <Box sx={{ position: "relative", width: "100%", height: "100vh", overflow: "hidden", bgcolor: "#f8f7f4" }}>
      <Paper
        elevation={3}
        sx={{
          position: "fixed",
          top: 14,
          left: "50%",
          transform: "translateX(-50%)",
          width: { xs: "calc(100vw - 24px)", md: "min(960px, calc(100vw - 64px))" },
          height: 40,
          display: "flex",
          alignItems: "center",
          borderRadius: 1.5,
          border: "1px solid #eadbc7",
          bgcolor: "rgba(255, 255, 255, 0.82)",
          backdropFilter: "blur(2px)",
          zIndex: (theme) => theme.zIndex.appBar
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1} sx={{ width: "100%", px: 1, lineHeight: 1, "& > *": { flexShrink: 0 } }}>
          <Tooltip title="载入图片">
            <IconButton color="primary" size="small" onClick={handleLoadImageClick} sx={{ width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <AddPhotoAlternateIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <FormControl size="small" sx={{ minWidth: 120, "& .MuiInputBase-root": { height: 30, fontSize: 12 }, "& .MuiInputLabel-root": { fontSize: 12 }, "& .MuiSelect-select": { py: 0.25 } }}>
            <InputLabel id="editor2-map-page-label">Page</InputLabel>
            <Select labelId="editor2-map-page-label" label="Page" value={selectedMapPage} onChange={(event) => setSelectedMapPage(String(event.target.value || ""))}>
              {mapPages.map((page) => <MenuItem key={page.page} value={String(page.page)}>{page.label}</MenuItem>)}
            </Select>
          </FormControl>
          <Tooltip title="导入地图">
            <span>
              <IconButton color="primary" size="small" onClick={handleImportMapPage} disabled={!selectedMapPage} sx={{ width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <FileDownloadIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="保存">
            <span>
              <IconButton color="primary" size="small" onClick={handleSaveMap} disabled={isSavingMap} sx={{ width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <SaveIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="加载最新存档">
            <span>
              <IconButton color="primary" size="small" onClick={handleLoadLatestMap} disabled={isLoadingMap} sx={{ width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <FolderOpenIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Typography variant="body2" color="text.secondary" sx={{ display: "inline-flex", alignItems: "center", height: 30, lineHeight: 1 }}>
            Objects {objects.length}
          </Typography>
          {importStatus ? <Typography variant="body2" color="text.secondary" sx={{ display: "inline-flex", alignItems: "center", height: 30, lineHeight: 1 }}>{importStatus}</Typography> : null}
          {saveStatus ? <Typography variant="body2" color="text.secondary" sx={{ display: "inline-flex", alignItems: "center", height: 30, lineHeight: 1 }}>{saveStatus}</Typography> : null}
        </Stack>
      </Paper>
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageFileChange} style={{ display: "none" }} />
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onWheel={handleWheel}
        style={{ width: "100%", height: "100%", display: "block", cursor: canvasCursor, touchAction: "none" }}
      />
      {selectedObject ? (
        <Paper
          elevation={4}
          sx={{
            position: "fixed",
            top: 72,
            right: 16,
            width: 240,
            p: 1.5,
            border: "1px solid #eadbc7",
            zIndex: (theme) => theme.zIndex.appBar
          }}
        >
          <Stack spacing={1}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{selectedObject.name}</Typography>
            {["x", "y", "w", "h", "rotation", "scale", "z"].map((field) => (
              <TextField
                key={field}
                label={field}
                type="number"
                size="small"
                value={selectedObject.transform[field]}
                onChange={(event) => updateSelectedObjectTransform(field, event.target.value)}
              />
            ))}
            <TextField label="parent" size="small" value={selectedObject.parentId || ""} onChange={(event) => commitObjectsChange((current) => current.map((object) => object.id === selectedObjectId ? { ...object, parentId: event.target.value } : object))} />
          </Stack>
        </Paper>
      ) : null}
    </Box>
  );
}
