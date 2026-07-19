import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const METERS_PER_DEGREE_LAT = 111320;

function degreesToRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function radiansToDegrees(radians) {
  return (radians * 180) / Math.PI;
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function projectToXY(latitude, longitude, origin) {
  const originLatRadians = degreesToRadians(origin.latitude);
  const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(originLatRadians);

  return {
    x: (longitude - origin.longitude) * metersPerDegreeLon,
    y: (latitude - origin.latitude) * METERS_PER_DEGREE_LAT,
  };
}

function projectToLatLon(x, y, origin) {
  const originLatRadians = degreesToRadians(origin.latitude);
  const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(originLatRadians);

  return {
    latitude: origin.latitude + y / METERS_PER_DEGREE_LAT,
    longitude: origin.longitude + x / metersPerDegreeLon,
  };
}

function rotatePoint(x, y, angleRadians) {
  const cosAngle = Math.cos(angleRadians);
  const sinAngle = Math.sin(angleRadians);

  return {
    x: x * cosAngle - y * sinAngle,
    y: x * sinAngle + y * cosAngle,
  };
}

function getNodeElements(document) {
  return Array.from(document.getElementsByTagName('node'));
}

function getWayElements(document) {
  return Array.from(document.getElementsByTagName('way'));
}

function getBoundsElement(document) {
  return document.getElementsByTagName('bounds')[0] ?? null;
}

function buildNodeStates(document) {
  const nodeStates = new Map();

  for (const nodeElement of getNodeElements(document)) {
    const id = nodeElement.getAttribute('id');
    const latitude = parseNumber(nodeElement.getAttribute('lat'));
    const longitude = parseNumber(nodeElement.getAttribute('lon'));

    if (!id || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      continue;
    }

    nodeStates.set(id, {
      id,
      element: nodeElement,
      latitude,
      longitude,
      x: 0,
      y: 0,
    });
  }

  return nodeStates;
}

function getMapOrigin(document, nodeStates) {
  const boundsElement = getBoundsElement(document);
  if (boundsElement) {
    const minLat = parseNumber(boundsElement.getAttribute('minlat'));
    const minLon = parseNumber(boundsElement.getAttribute('minlon'));
    const maxLat = parseNumber(boundsElement.getAttribute('maxlat'));
    const maxLon = parseNumber(boundsElement.getAttribute('maxlon'));

    if ([minLat, minLon, maxLat, maxLon].every(Number.isFinite)) {
      return {
        latitude: (minLat + maxLat) / 2,
        longitude: (minLon + maxLon) / 2,
      };
    }
  }

  let latitudeSum = 0;
  let longitudeSum = 0;
  let count = 0;

  for (const nodeState of nodeStates.values()) {
    latitudeSum += nodeState.latitude;
    longitudeSum += nodeState.longitude;
    count += 1;
  }

  if (count === 0) {
    return { latitude: 0, longitude: 0 };
  }

  return {
    latitude: latitudeSum / count,
    longitude: longitudeSum / count,
  };
}

function writeNodeStatesBack(nodeStates) {
  for (const nodeState of nodeStates.values()) {
    nodeState.element.setAttribute('lat', nodeState.latitude.toFixed(7));
    nodeState.element.setAttribute('lon', nodeState.longitude.toFixed(7));
  }
}

function updateBoundsFromNodeStates(document, nodeStates) {
  const boundsElement = getBoundsElement(document);
  if (!boundsElement) {
    return;
  }

  let minLat = Number.POSITIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;

  for (const nodeState of nodeStates.values()) {
    minLat = Math.min(minLat, nodeState.latitude);
    minLon = Math.min(minLon, nodeState.longitude);
    maxLat = Math.max(maxLat, nodeState.latitude);
    maxLon = Math.max(maxLon, nodeState.longitude);
  }

  if (!Number.isFinite(minLat)) {
    return;
  }

  boundsElement.setAttribute('minlat', minLat.toFixed(7));
  boundsElement.setAttribute('minlon', minLon.toFixed(7));
  boundsElement.setAttribute('maxlat', maxLat.toFixed(7));
  boundsElement.setAttribute('maxlon', maxLon.toFixed(7));
}

function classifySegment(deltaX, deltaY, toleranceDegrees) {
  if (deltaX === 0 && deltaY === 0) {
    return null;
  }

  const angleDegrees = Math.abs(radiansToDegrees(Math.atan2(deltaY, deltaX))) % 180;

  if (angleDegrees <= toleranceDegrees || angleDegrees >= 180 - toleranceDegrees) {
    return 'horizontal';
  }

  if (Math.abs(angleDegrees - 90) <= toleranceDegrees) {
    return 'vertical';
  }

  return null;
}

function average(values) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getWayNodeRefs(wayElement) {
  return Array.from(wayElement.getElementsByTagName('nd'))
    .map((ndElement) => ndElement.getAttribute('ref'))
    .filter(Boolean);
}

function normalizeOrientationRadians(angleRadians) {
  let angle = angleRadians % Math.PI;
  if (angle < 0) {
    angle += Math.PI;
  }
  return angle;
}

function orientationDistanceRadians(a, b) {
  const diff = Math.abs(a - b);
  return Math.min(diff, Math.PI - diff);
}

function averageOrientationRadians(values) {
  if (values.length === 0) {
    return 0;
  }

  let sinSum = 0;
  let cosSum = 0;
  for (const angle of values) {
    sinSum += Math.sin(2 * angle);
    cosSum += Math.cos(2 * angle);
  }

  return normalizeOrientationRadians(0.5 * Math.atan2(sinSum, cosSum));
}

function shortestSignedAngleDifference(from, to) {
  let diff = to - from;
  while (diff <= -Math.PI) {
    diff += 2 * Math.PI;
  }
  while (diff > Math.PI) {
    diff -= 2 * Math.PI;
  }
  return diff;
}

function collectWayEdges(wayElements) {
  const edges = [];

  for (const wayElement of wayElements) {
    const nodeRefs = getWayNodeRefs(wayElement);
    for (let index = 1; index < nodeRefs.length; index += 1) {
      const fromId = nodeRefs[index - 1];
      const toId = nodeRefs[index];
      if (fromId && toId) {
        edges.push([fromId, toId]);
      }
    }
  }

  return edges;
}

function buildEdgeSegments(nodeStates, edges) {
  const segments = [];

  for (const [fromId, toId] of edges) {
    const fromState = nodeStates.get(fromId);
    const toState = nodeStates.get(toId);
    if (!fromState || !toState) {
      continue;
    }

    const deltaX = toState.x - fromState.x;
    const deltaY = toState.y - fromState.y;
    const length = Math.hypot(deltaX, deltaY);
    if (length <= 0) {
      continue;
    }

    const angle = Math.atan2(deltaY, deltaX);
    segments.push({
      fromId,
      toId,
      fromX: fromState.x,
      fromY: fromState.y,
      toX: toState.x,
      toY: toState.y,
      midX: (fromState.x + toState.x) / 2,
      midY: (fromState.y + toState.y) / 2,
      length,
      angle,
      orientation: normalizeOrientationRadians(angle),
    });
  }

  return segments;
}

function queueAxisUpdate(updateMap, nodeId, axis, value) {
  const current = updateMap.get(nodeId) ?? { xValues: [], yValues: [] };
  if (axis === 'x') {
    current.xValues.push(value);
  } else {
    current.yValues.push(value);
  }
  updateMap.set(nodeId, current);
}

function applyQueuedUpdates(nodeStates, updateMap) {
  let changed = false;

  for (const [nodeId, update] of updateMap.entries()) {
    const state = nodeStates.get(nodeId);
    if (!state) {
      continue;
    }

    const nextX = update.xValues.length > 0 ? average(update.xValues) : state.x;
    const nextY = update.yValues.length > 0 ? average(update.yValues) : state.y;

    if (nextX !== state.x || nextY !== state.y) {
      state.x = nextX;
      state.y = nextY;
      changed = true;
    }
  }

  return changed;
}

function orthogonalizeSegments(nodeStates, wayEdges, toleranceDegrees, iterations) {
  for (let passIndex = 0; passIndex < iterations; passIndex += 1) {
    const updates = new Map();

    for (const [fromId, toId] of wayEdges) {
      const fromState = nodeStates.get(fromId);
      const toState = nodeStates.get(toId);
      if (!fromState || !toState) {
        continue;
      }

      const deltaX = toState.x - fromState.x;
      const deltaY = toState.y - fromState.y;
      const orientation = classifySegment(deltaX, deltaY, toleranceDegrees);

      if (orientation === 'horizontal') {
        const targetY = (fromState.y + toState.y) / 2;
        queueAxisUpdate(updates, fromId, 'y', targetY);
        queueAxisUpdate(updates, toId, 'y', targetY);
      } else if (orientation === 'vertical') {
        const targetX = (fromState.x + toState.x) / 2;
        queueAxisUpdate(updates, fromId, 'x', targetX);
        queueAxisUpdate(updates, toId, 'x', targetX);
      }
    }

    if (!applyQueuedUpdates(nodeStates, updates)) {
      break;
    }
  }
}

function enforceParallelNearbySegments(
  nodeStates,
  wayEdges,
  angleThresholdDegrees,
  nearbyDistanceMeters,
  strength,
  iterations,
) {
  if (strength <= 0 || nearbyDistanceMeters <= 0 || angleThresholdDegrees <= 0) {
    return;
  }

  const clampedStrength = Math.max(0, Math.min(1, strength));
  const angleThresholdRadians = degreesToRadians(angleThresholdDegrees);
  const cellSize = Math.max(nearbyDistanceMeters, 0.0001);

  for (let passIndex = 0; passIndex < iterations; passIndex += 1) {
    const segments = buildEdgeSegments(nodeStates, wayEdges);
    if (segments.length === 0) {
      return;
    }

    const buckets = new Map();
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const cellX = Math.floor(segment.midX / cellSize);
      const cellY = Math.floor(segment.midY / cellSize);
      const key = `${cellX}:${cellY}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(index);
      buckets.set(key, bucket);
    }

    const targetOrientations = new Array(segments.length).fill(null);

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const cellX = Math.floor(segment.midX / cellSize);
      const cellY = Math.floor(segment.midY / cellSize);
      const orientationCandidates = [segment.orientation];

      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const bucket = buckets.get(`${cellX + offsetX}:${cellY + offsetY}`);
          if (!bucket) {
            continue;
          }

          for (const otherIndex of bucket) {
            if (otherIndex === index) {
              continue;
            }

            const other = segments[otherIndex];
            const midpointDistance = Math.hypot(other.midX - segment.midX, other.midY - segment.midY);
            if (midpointDistance > nearbyDistanceMeters) {
              continue;
            }

            const orientationDiff = orientationDistanceRadians(segment.orientation, other.orientation);
            if (orientationDiff <= angleThresholdRadians) {
              orientationCandidates.push(other.orientation);
            }
          }
        }
      }

      targetOrientations[index] = averageOrientationRadians(orientationCandidates);
    }

    const updates = new Map();

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const targetOrientation = targetOrientations[index];
      if (targetOrientation === null) {
        continue;
      }

      const signedTargetA = targetOrientation;
      const signedTargetB = targetOrientation - Math.PI;
      const diffA = Math.abs(shortestSignedAngleDifference(segment.angle, signedTargetA));
      const diffB = Math.abs(shortestSignedAngleDifference(segment.angle, signedTargetB));
      const selectedTarget = diffA <= diffB ? signedTargetA : signedTargetB;
      const nextAngle = segment.angle + clampedStrength * shortestSignedAngleDifference(segment.angle, selectedTarget);

      const halfLength = segment.length / 2;
      const dirX = Math.cos(nextAngle);
      const dirY = Math.sin(nextAngle);
      const targetFromX = segment.midX - dirX * halfLength;
      const targetFromY = segment.midY - dirY * halfLength;
      const targetToX = segment.midX + dirX * halfLength;
      const targetToY = segment.midY + dirY * halfLength;

      const keepOrderDistance =
        Math.hypot(targetFromX - segment.fromX, targetFromY - segment.fromY) +
        Math.hypot(targetToX - segment.toX, targetToY - segment.toY);
      const swapOrderDistance =
        Math.hypot(targetFromX - segment.toX, targetFromY - segment.toY) +
        Math.hypot(targetToX - segment.fromX, targetToY - segment.fromY);

      if (keepOrderDistance <= swapOrderDistance) {
        queueAxisUpdate(updates, segment.fromId, 'x', targetFromX);
        queueAxisUpdate(updates, segment.fromId, 'y', targetFromY);
        queueAxisUpdate(updates, segment.toId, 'x', targetToX);
        queueAxisUpdate(updates, segment.toId, 'y', targetToY);
      } else {
        queueAxisUpdate(updates, segment.fromId, 'x', targetToX);
        queueAxisUpdate(updates, segment.fromId, 'y', targetToY);
        queueAxisUpdate(updates, segment.toId, 'x', targetFromX);
        queueAxisUpdate(updates, segment.toId, 'y', targetFromY);
      }
    }

    if (!applyQueuedUpdates(nodeStates, updates)) {
      break;
    }
  }
}

function buildNearbyPairs(nodeStates, thresholdMeters) {
  const pairs = [];
  const cellSize = Math.max(thresholdMeters, 0.0001);
  const buckets = new Map();

  for (const state of nodeStates.values()) {
    const cellX = Math.floor(state.x / cellSize);
    const cellY = Math.floor(state.y / cellSize);

    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const bucket = buckets.get(`${cellX + offsetX}:${cellY + offsetY}`);
        if (!bucket) {
          continue;
        }

        for (const candidate of bucket) {
          const distance = Math.hypot(candidate.x - state.x, candidate.y - state.y);
          if (distance <= thresholdMeters) {
            pairs.push([candidate.id, state.id]);
          }
        }
      }
    }

    const key = `${cellX}:${cellY}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(state);
    buckets.set(key, bucket);
  }

  return pairs;
}

function alignPairByDominantAxis(leftState, rightState, updates) {
  const deltaX = Math.abs(rightState.x - leftState.x);
  const deltaY = Math.abs(rightState.y - leftState.y);

  if (deltaX <= deltaY) {
    const targetX = (leftState.x + rightState.x) / 2;
    queueAxisUpdate(updates, leftState.id, 'x', targetX);
    queueAxisUpdate(updates, rightState.id, 'x', targetX);
  } else {
    const targetY = (leftState.y + rightState.y) / 2;
    queueAxisUpdate(updates, leftState.id, 'y', targetY);
    queueAxisUpdate(updates, rightState.id, 'y', targetY);
  }
}

function alignNearbyAndConnectedNodes(
  nodeStates,
  connectedEdges,
  nearbyDistanceMeters,
  connectedDistanceMeters,
  iterations,
) {
  for (let passIndex = 0; passIndex < iterations; passIndex += 1) {
    const updates = new Map();

    for (const [fromId, toId] of connectedEdges) {
      const fromState = nodeStates.get(fromId);
      const toState = nodeStates.get(toId);
      if (!fromState || !toState) {
        continue;
      }

      const distance = Math.hypot(toState.x - fromState.x, toState.y - fromState.y);
      if (distance <= connectedDistanceMeters) {
        alignPairByDominantAxis(fromState, toState, updates);
      }
    }

    const nearbyPairs = buildNearbyPairs(nodeStates, nearbyDistanceMeters);
    for (const [leftId, rightId] of nearbyPairs) {
      const leftState = nodeStates.get(leftId);
      const rightState = nodeStates.get(rightId);
      if (!leftState || !rightState) {
        continue;
      }

      alignPairByDominantAxis(leftState, rightState, updates);
    }

    if (!applyQueuedUpdates(nodeStates, updates)) {
      break;
    }
  }
}

function wayNodeDegreeMap(wayElements) {
  const degree = new Map();

  for (const wayElement of wayElements) {
    const refs = getWayNodeRefs(wayElement);
    for (const ref of refs) {
      degree.set(ref, (degree.get(ref) ?? 0) + 1);
    }
  }

  return degree;
}

function nodeHasTags(nodeElement) {
  return nodeElement.getElementsByTagName('tag').length > 0;
}

function signedTurnDegrees(a, b, c) {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const bcX = c.x - b.x;
  const bcY = c.y - b.y;

  const cross = abX * bcY - abY * bcX;
  const dot = abX * bcX + abY * bcY;
  return radiansToDegrees(Math.atan2(cross, dot));
}

function pointLineDistance(a, b, p) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denom = Math.hypot(dx, dy);
  if (denom === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }

  const cross = (p.x - a.x) * dy - (p.y - a.y) * dx;
  return Math.abs(cross) / denom;
}

function isProjectionInsideSegment(a, b, p) {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const apX = p.x - a.x;
  const apY = p.y - a.y;
  const denom = abX * abX + abY * abY;
  if (denom <= 0) {
    return false;
  }

  const t = (apX * abX + apY * abY) / denom;
  return t >= 0 && t <= 1;
}

function projectPointToLine(a, b, p) {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const denom = abX * abX + abY * abY;
  if (denom <= 0) {
    return { x: p.x, y: p.y };
  }

  const apX = p.x - a.x;
  const apY = p.y - a.y;
  const t = (apX * abX + apY * abY) / denom;
  return {
    x: a.x + abX * t,
    y: a.y + abY * t,
  };
}

function rewriteWayNodeRefs(wayElement, refs) {
  const removableNdChildren = Array.from(wayElement.childNodes).filter(
    (node) => node.nodeType === 1 && node.nodeName === 'nd',
  );

  for (const ndChild of removableNdChildren) {
    wayElement.removeChild(ndChild);
  }

  const firstTag = Array.from(wayElement.childNodes).find(
    (node) => node.nodeType === 1 && node.nodeName === 'tag',
  );

  for (const ref of refs) {
    const nd = wayElement.ownerDocument.createElement('nd');
    nd.setAttribute('ref', ref);
    if (firstTag) {
      wayElement.insertBefore(nd, firstTag);
    } else {
      wayElement.appendChild(nd);
    }
  }
}

function simplifyWayNodes(nodeStates, wayElements, simplifyOffsetMeters, simplifyAngleDegrees) {
  if (simplifyOffsetMeters <= 0 || simplifyAngleDegrees <= 0) {
    return;
  }

  const degreeMap = wayNodeDegreeMap(wayElements);

  for (const wayElement of wayElements) {
    let refs = getWayNodeRefs(wayElement);
    if (refs.length < 3) {
      continue;
    }

    const closed = refs[0] === refs[refs.length - 1];
    let changed = true;

    while (changed) {
      changed = false;
      const startIndex = closed ? 1 : 1;
      const endIndex = closed ? refs.length - 1 : refs.length - 1;

      for (let index = startIndex; index < endIndex; index += 1) {
        const prevId = refs[index - 1];
        const currId = refs[index];
        const nextId = refs[index + 1];

        if (!prevId || !currId || !nextId) {
          continue;
        }

        const currState = nodeStates.get(currId);
        const prevState = nodeStates.get(prevId);
        const nextState = nodeStates.get(nextId);
        if (!currState || !prevState || !nextState) {
          continue;
        }

        if (nodeHasTags(currState.element)) {
          continue;
        }

        if ((degreeMap.get(currId) ?? 0) > 1) {
          continue;
        }

        if (!isProjectionInsideSegment(prevState, nextState, currState)) {
          continue;
        }

        const turnDegrees = Math.abs(signedTurnDegrees(prevState, currState, nextState));
        if (turnDegrees > simplifyAngleDegrees) {
          continue;
        }

        const offset = pointLineDistance(prevState, nextState, currState);
        if (offset > simplifyOffsetMeters) {
          continue;
        }

        refs.splice(index, 1);
        degreeMap.set(currId, 0);
        changed = true;
        break;
      }

      if (!closed && refs.length < 3) {
        break;
      }
      if (closed && refs.length < 4) {
        break;
      }
    }

    rewriteWayNodeRefs(wayElement, refs);
  }
}

function segmentOrientationForRefs(nodeStates, fromId, toId) {
  const fromState = nodeStates.get(fromId);
  const toState = nodeStates.get(toId);
  if (!fromState || !toState) {
    return null;
  }

  const dx = toState.x - fromState.x;
  const dy = toState.y - fromState.y;
  if (dx === 0 && dy === 0) {
    return null;
  }

  return normalizeOrientationRadians(Math.atan2(dy, dx));
}

function straightenSimilarWayRuns(
  nodeStates,
  wayElements,
  straightenAngleDegrees,
  straightenOffsetMeters,
  straightenStrength,
  iterations,
) {
  if (straightenAngleDegrees <= 0 || straightenOffsetMeters <= 0 || straightenStrength <= 0) {
    return;
  }

  const angleThreshold = degreesToRadians(straightenAngleDegrees);
  const clampedStrength = Math.max(0, Math.min(1, straightenStrength));

  for (let passIndex = 0; passIndex < iterations; passIndex += 1) {
    const degreeMap = wayNodeDegreeMap(wayElements);
    const updates = new Map();

    for (const wayElement of wayElements) {
      const refs = getWayNodeRefs(wayElement);
      if (refs.length < 3) {
        continue;
      }

      let runStart = 0;
      while (runStart + 2 < refs.length) {
        const firstOrientation = segmentOrientationForRefs(nodeStates, refs[runStart], refs[runStart + 1]);
        if (firstOrientation === null) {
          runStart += 1;
          continue;
        }

        let runEnd = runStart + 1;
        let orientationBuffer = [firstOrientation];

        while (runEnd + 1 < refs.length) {
          const nextOrientation = segmentOrientationForRefs(nodeStates, refs[runEnd], refs[runEnd + 1]);
          if (nextOrientation === null) {
            break;
          }

          const avgOrientation = averageOrientationRadians(orientationBuffer);
          if (orientationDistanceRadians(avgOrientation, nextOrientation) > angleThreshold) {
            break;
          }

          orientationBuffer.push(nextOrientation);
          runEnd += 1;
        }

        if (runEnd - runStart >= 2) {
          const startState = nodeStates.get(refs[runStart]);
          const endState = nodeStates.get(refs[runEnd]);
          if (startState && endState) {
            for (let index = runStart + 1; index < runEnd; index += 1) {
              const nodeId = refs[index];
              const state = nodeStates.get(nodeId);
              if (!state) {
                continue;
              }

              if (nodeHasTags(state.element)) {
                continue;
              }

              if ((degreeMap.get(nodeId) ?? 0) > 1) {
                continue;
              }

              const projected = projectPointToLine(startState, endState, state);
              const offset = Math.hypot(projected.x - state.x, projected.y - state.y);
              if (offset > straightenOffsetMeters) {
                continue;
              }

              const targetX = state.x + (projected.x - state.x) * clampedStrength;
              const targetY = state.y + (projected.y - state.y) * clampedStrength;
              queueAxisUpdate(updates, nodeId, 'x', targetX);
              queueAxisUpdate(updates, nodeId, 'y', targetY);
            }
          }
        }

        runStart = runEnd;
      }
    }

    if (!applyQueuedUpdates(nodeStates, updates)) {
      break;
    }
  }
}

function snapAllNodesToVirtualGrid(nodeStates, gridSizeMeters) {
  if (gridSizeMeters <= 0) {
    return;
  }

  for (const state of nodeStates.values()) {
    state.x = Math.round(state.x / gridSizeMeters) * gridSizeMeters;
    state.y = Math.round(state.y / gridSizeMeters) * gridSizeMeters;
  }
}

function collectReferencedNodeIds(document) {
  const refs = new Set();

  for (const wayElement of getWayElements(document)) {
    for (const ref of getWayNodeRefs(wayElement)) {
      refs.add(ref);
    }
  }

  const relationElements = Array.from(document.getElementsByTagName('relation'));
  for (const relation of relationElements) {
    const members = Array.from(relation.getElementsByTagName('member'));
    for (const member of members) {
      if (member.getAttribute('type') === 'node') {
        const ref = member.getAttribute('ref');
        if (ref) {
          refs.add(ref);
        }
      }
    }
  }

  return refs;
}

function removeEmptyUnreferencedNodes(document, nodeStates) {
  const referencedNodeIds = collectReferencedNodeIds(document);

  for (const [nodeId, state] of nodeStates.entries()) {
    if (referencedNodeIds.has(nodeId)) {
      continue;
    }

    if (nodeHasTags(state.element)) {
      continue;
    }

    const parent = state.element.parentNode;
    if (parent) {
      parent.removeChild(state.element);
    }

    nodeStates.delete(nodeId);
  }
}

function rotateAllNodes(nodeStates, angleRadians) {
  for (const state of nodeStates.values()) {
    const rotated = rotatePoint(state.x, state.y, angleRadians);
    state.x = rotated.x;
    state.y = rotated.y;
  }
}

function snapNodesToVirtualGrid(nodeStates, gridSizeMeters) {
  if (gridSizeMeters <= 0) {
    return;
  }

  for (const state of nodeStates.values()) {
    state.x = Math.round(state.x / gridSizeMeters) * gridSizeMeters;
    state.y = Math.round(state.y / gridSizeMeters) * gridSizeMeters;
  }
}

export function loadOsmDocument(xmlText) {
  const document = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (!document || document.documentElement?.nodeName !== 'osm') {
    throw new Error('Failed to parse OSM XML.');
  }

  return document;
}

export function transformOsmDocument(document, options) {
  const nodeStates = buildNodeStates(document);
  const wayElements = getWayElements(document);
  const wayEdges = collectWayEdges(wayElements);
  const origin = getMapOrigin(document, nodeStates);

  for (const state of nodeStates.values()) {
    const projected = projectToXY(state.latitude, state.longitude, origin);
    state.x = projected.x;
    state.y = projected.y;
  }

  const rotateForwardRadians = degreesToRadians(options.clockwise ? -options.angleDegrees : options.angleDegrees);
  rotateAllNodes(nodeStates, rotateForwardRadians);

  orthogonalizeSegments(nodeStates, wayEdges, options.orthToleranceDegrees, options.iterations);
  enforceParallelNearbySegments(
    nodeStates,
    wayEdges,
    options.parallelAngleThresholdDegrees,
    options.parallelNearbyDistanceMeters,
    options.parallelStrength,
    options.iterations,
  );
  alignNearbyAndConnectedNodes(
    nodeStates,
    wayEdges,
    options.proximityDistanceMeters,
    options.connectedDistanceMeters,
    options.iterations,
  );
  straightenSimilarWayRuns(
    nodeStates,
    wayElements,
    options.straightenAngleDegrees,
    options.straightenOffsetMeters,
    options.straightenStrength,
    options.iterations,
  );
  snapAllNodesToVirtualGrid(nodeStates, options.gridSizeMeters);
  simplifyWayNodes(
    nodeStates,
    wayElements,
    options.simplifyOffsetMeters,
    options.simplifyAngleDegrees,
  );
  snapNodesToVirtualGrid(nodeStates, options.gridSizeMeters);

  rotateAllNodes(nodeStates, -rotateForwardRadians);

  for (const state of nodeStates.values()) {
    const geographic = projectToLatLon(state.x, state.y, origin);
    state.latitude = geographic.latitude;
    state.longitude = geographic.longitude;
  }

  removeEmptyUnreferencedNodes(document, nodeStates);

  writeNodeStatesBack(nodeStates);
  updateBoundsFromNodeStates(document, nodeStates);
}

export function writeOsmDocument(document) {
  return `${new XMLSerializer().serializeToString(document)}\n`;
}
