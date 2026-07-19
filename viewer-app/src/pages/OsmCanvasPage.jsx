import { useEffect, useMemo, useRef, useState } from "react";
import { Box, FormControl, InputLabel, MenuItem, Paper, Select, Stack, Typography } from "@mui/material";
import osmStyleConfig from "../data/osmStyleConfig.json";

const OSM_FILE_API = import.meta.env.VITE_OSM_FILE_API_URL || "http://127.0.0.1:3000/api/osm/file";
const LOCKED_OSM_FILE = "8__.osm";
const GRID_WORLD_STEP = 100;

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

function toWorldPoint(point, viewState) {
  return {
    x: (point.x - viewState.offsetX) / viewState.zoom,
    y: (point.y - viewState.offsetY) / viewState.zoom
  };
}

function doesTagValueMatch(actualValue, expectedValue) {
  if (Array.isArray(actualValue)) {
    if (expectedValue === "*") {
      return actualValue.length > 0;
    }
    if (Array.isArray(expectedValue)) {
      const expectedValues = expectedValue.map(String);
      return actualValue.map(String).some((value) => expectedValues.includes(value));
    }
    return actualValue.map(String).includes(String(expectedValue));
  }
  if (expectedValue === "*") {
    return actualValue !== undefined;
  }
  if (Array.isArray(expectedValue)) {
    return expectedValue.map(String).includes(String(actualValue));
  }
  return String(actualValue) === String(expectedValue);
}

function doesTagGroupMatch(ruleTags, tags) {
  if (!ruleTags || typeof ruleTags !== "object" || Array.isArray(ruleTags)) {
    return true;
  }
  return Object.entries(ruleTags).every(([key, expectedValue]) => doesTagValueMatch(tags[key], expectedValue));
}

function doesRuleMatchTags(rule, tags) {
  if (Array.isArray(rule?.tags)) {
    return rule.tags.some((tagGroup) => doesTagGroupMatch(tagGroup, tags));
  }
  return doesTagGroupMatch(rule?.tags, tags);
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

function getWayStyle(way) {
  const matchTags = mergeTags(way.relationTags || {}, way.tags || {});
  const matchedRule = (Array.isArray(osmStyleConfig.rules) ? osmStyleConfig.rules : []).find((rule) => doesRuleMatchTags(rule, matchTags));
  return {
    ...(osmStyleConfig.defaultStyle || {}),
    ...(matchedRule?.style || {})
  };
}

function getStrokeWidth(style, zoom) {
  const strokeWidth = Number(style.strokeWidth || 1.15);
  return style.scaleStrokeWidth ? strokeWidth : Math.max(strokeWidth / zoom, 0.7);
}

function getLineDash(style, zoom) {
  if (!Array.isArray(style.lineDash)) {
    return [];
  }
  const lineDash = style.lineDash.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);
  if (style.scaleLineDash === false) {
    return lineDash.map((value) => value / zoom);
  }
  return lineDash;
}

function getLineDashOffset(style, zoom) {
  const offset = Number(style.lineDashOffset || 0);
  if (!Number.isFinite(offset)) {
    return 0;
  }
  return style.scaleLineDash === false ? offset / zoom : offset;
}

function getStyleLayer(style) {
  const layer = Number(style.layer || 0);
  return Number.isFinite(layer) ? layer : 0;
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

function parseOsmWays(osmText) {
  const document = new DOMParser().parseFromString(osmText, "application/xml");
  const parserError = document.querySelector("parsererror");
  if (parserError) {
    throw new Error("Invalid OSM XML");
  }

  const rawNodes = [...document.querySelectorAll("node[id][lat][lon]")].map((node) => ({
    id: node.getAttribute("id"),
    lat: Number(node.getAttribute("lat")),
    lon: Number(node.getAttribute("lon"))
  })).filter((node) => node.id && Number.isFinite(node.lat) && Number.isFinite(node.lon));

  if (!rawNodes.length) {
    return { ways: [], bounds: null };
  }

  const centerLat = rawNodes.reduce((sum, node) => sum + node.lat, 0) / rawNodes.length;
  const centerLon = rawNodes.reduce((sum, node) => sum + node.lon, 0) / rawNodes.length;
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = Math.max(0.0001, Math.cos(centerLat * Math.PI / 180)) * metersPerDegreeLat;
  const nodes = new Map(rawNodes.map((node) => [node.id, {
    x: (node.lon - centerLon) * metersPerDegreeLon,
    y: -(node.lat - centerLat) * metersPerDegreeLat
  }]));

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
    const points = [...way.querySelectorAll("nd[ref]")]
      .map((nodeRef) => nodes.get(nodeRef.getAttribute("ref")))
      .filter(Boolean);
    const tags = Object.fromEntries([...way.querySelectorAll("tag[k][v]")].map((tag) => [tag.getAttribute("k"), tag.getAttribute("v")]));
    return { id, points, tags, relationTags: relationTagsByWayId.get(id) || {} };
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

export function OsmCanvasPage() {
  const canvasRef = useRef(null);
  const frameRef = useRef(0);
  const dragStateRef = useRef({ type: "none", pointerId: null, lastX: 0, lastY: 0 });
  const hasCenteredOriginRef = useRef(false);

  const [ways, setWays] = useState([]);
  const [status, setStatus] = useState("Loading OSM...");
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [viewState, setViewState] = useState({ zoom: 1, offsetX: 0, offsetY: 0 });

  const canvasCursor = useMemo(() => {
    if (isPanning) {
      return "grabbing";
    }
    return isSpacePressed ? "grab" : "default";
  }, [isPanning, isSpacePressed]);

  useEffect(() => {
    let isMounted = true;
    async function loadLockedOsm() {
      setStatus("Loading OSM...");
      try {
        const response = await fetch(`${OSM_FILE_API}?path=${encodeURIComponent(LOCKED_OSM_FILE)}`);
        const json = await readJson(response);
        const parsed = parseOsmWays(String(json.data?.content || ""));
        if (!isMounted) {
          return;
        }
        setWays(parsed.ways);
        setStatus(`${LOCKED_OSM_FILE}: ${parsed.ways.length} paths`);

        const canvas = canvasRef.current;
        if (canvas && parsed.bounds) {
          const nextViewState = getFitViewState(parsed.bounds, canvas.clientWidth, canvas.clientHeight);
          if (nextViewState) {
            setViewState(nextViewState);
          }
        }
      } catch (error) {
        if (isMounted) {
          setWays([]);
          setStatus(error.message || "Failed to load OSM");
        }
      }
    }
    loadLockedOsm();
    return () => {
      isMounted = false;
    };
  }, []);

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
      const didResize = canvas.width !== width || canvas.height !== height;
      if (didResize) {
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

      context.fillStyle = "#f7f6f1";
      context.fillRect(0, 0, width, height);

      const leftWorld = (0 - viewState.offsetX) / viewState.zoom;
      const rightWorld = (width - viewState.offsetX) / viewState.zoom;
      const topWorld = (0 - viewState.offsetY) / viewState.zoom;
      const bottomWorld = (height - viewState.offsetY) / viewState.zoom;
      const firstGridX = Math.floor(leftWorld / GRID_WORLD_STEP) * GRID_WORLD_STEP;
      const lastGridX = Math.ceil(rightWorld / GRID_WORLD_STEP) * GRID_WORLD_STEP;
      const firstGridY = Math.floor(topWorld / GRID_WORLD_STEP) * GRID_WORLD_STEP;
      const lastGridY = Math.ceil(bottomWorld / GRID_WORLD_STEP) * GRID_WORLD_STEP;

      context.strokeStyle = "rgba(87, 97, 97, 0.16)";
      context.lineWidth = 1;
      context.beginPath();
      for (let worldX = firstGridX; worldX <= lastGridX; worldX += GRID_WORLD_STEP) {
        const screenX = worldX * viewState.zoom + viewState.offsetX;
        context.moveTo(screenX, 0);
        context.lineTo(screenX, height);
      }
      for (let worldY = firstGridY; worldY <= lastGridY; worldY += GRID_WORLD_STEP) {
        const screenY = worldY * viewState.zoom + viewState.offsetY;
        context.moveTo(0, screenY);
        context.lineTo(width, screenY);
      }
      context.stroke();

      context.strokeStyle = "rgba(77, 80, 78, 0.55)";
      context.lineWidth = 1.25;
      context.beginPath();
      context.moveTo(0, viewState.offsetY);
      context.lineTo(width, viewState.offsetY);
      context.moveTo(viewState.offsetX, 0);
      context.lineTo(viewState.offsetX, height);
      context.stroke();

      context.save();
      context.translate(viewState.offsetX, viewState.offsetY);
      context.scale(viewState.zoom, viewState.zoom);
      context.lineCap = "round";
      context.lineJoin = "round";
      const styledWays = ways.map((way, index) => ({ way, index, style: getWayStyle(way) }))
        .sort((left, right) => getStyleLayer(left.style) - getStyleLayer(right.style) || left.index - right.index);
      styledWays.forEach(({ way, style }) => {
        if (style.fill && isClosedWay(way)) {
          context.fillStyle = style.fill;
          context.beginPath();
          drawWayPath(context, way);
          context.closePath();
          context.fill();
        }

        if (!style.stroke) {
          return;
        }
        context.strokeStyle = style.stroke;
        context.lineWidth = getStrokeWidth(style, viewState.zoom);
        context.setLineDash(getLineDash(style, viewState.zoom));
        context.lineDashOffset = getLineDashOffset(style, viewState.zoom);
        context.beginPath();
        drawWayPath(context, way);
        context.stroke();
      });
      context.setLineDash([]);
      context.lineDashOffset = 0;
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
  }, [viewState, ways]);

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

  function handlePointerDown(event) {
    if (event.button !== 0 || !isSpacePressed) {
      return;
    }
    event.preventDefault();
    dragStateRef.current = { type: "pan", pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
    setIsPanning(true);
    canvasRef.current?.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event) {
    if (dragStateRef.current.type !== "pan" || dragStateRef.current.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const dx = event.clientX - dragStateRef.current.lastX;
    const dy = event.clientY - dragStateRef.current.lastY;
    dragStateRef.current.lastX = event.clientX;
    dragStateRef.current.lastY = event.clientY;
    setViewState((current) => ({
      ...current,
      offsetX: current.offsetX + dx,
      offsetY: current.offsetY + dy
    }));
  }

  function endPointerPan(pointerId) {
    if (dragStateRef.current.pointerId !== pointerId) {
      return;
    }
    dragStateRef.current = { type: "none", pointerId: null, lastX: 0, lastY: 0 };
    setIsPanning(false);
  }

  function handleWheel(event) {
    event.preventDefault();
    const canvasPoint = getCanvasPoint(event);
    if (!canvasPoint) {
      return;
    }

    setViewState((current) => {
      const nextZoom = clamp(current.zoom * Math.exp(-event.deltaY * 0.0015), 0.03, 80);
      const worldPoint = toWorldPoint(canvasPoint, current);
      return {
        zoom: nextZoom,
        offsetX: canvasPoint.x - worldPoint.x * nextZoom,
        offsetY: canvasPoint.y - worldPoint.y * nextZoom
      };
    });
  }

  return (
    <Box sx={{ position: "relative", width: "100%", height: "100vh", overflow: "hidden", bgcolor: "#f7f6f1" }}>
      <Paper
        elevation={3}
        sx={{
          position: "fixed",
          top: 14,
          left: "50%",
          transform: "translateX(-50%)",
          width: { xs: "calc(100vw - 24px)", md: "min(720px, calc(100vw - 64px))" },
          height: 42,
          display: "flex",
          alignItems: "center",
          borderRadius: 1.5,
          border: "1px solid #d9d4c6",
          bgcolor: "rgba(255, 255, 255, 0.86)",
          backdropFilter: "blur(3px)",
          zIndex: (theme) => theme.zIndex.appBar
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.25} sx={{ width: "100%", px: 1.25, "& > *": { flexShrink: 0 } }}>
          <FormControl size="small" sx={{ minWidth: { xs: 180, sm: 280 }, flex: "1 1 auto", "& .MuiInputBase-root": { height: 32, fontSize: 12 }, "& .MuiInputLabel-root": { fontSize: 12 }, "& .MuiSelect-select": { py: 0.35 } }}>
            <InputLabel id="osm-file-label">OSM</InputLabel>
            <Select labelId="osm-file-label" label="OSM" value={LOCKED_OSM_FILE} disabled>
              <MenuItem value={LOCKED_OSM_FILE}>{LOCKED_OSM_FILE}</MenuItem>
            </Select>
          </FormControl>
          <Typography variant="body2" color="text.secondary" sx={{ display: { xs: "none", sm: "inline-flex" }, alignItems: "center", height: 32, lineHeight: 1, whiteSpace: "nowrap" }}>
            {status}
          </Typography>
        </Stack>
      </Paper>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => endPointerPan(event.pointerId)}
        onPointerCancel={(event) => endPointerPan(event.pointerId)}
        onWheel={handleWheel}
        style={{ width: "100%", height: "100%", display: "block", cursor: canvasCursor, touchAction: "none" }}
      />
    </Box>
  );
}