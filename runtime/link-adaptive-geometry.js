export const CURRENT_LINK_MIN_SEGMENTS = 18;
export const CURRENT_LINK_MAX_SEGMENTS = 42;
export const CURRENT_LINK_SEGMENT_PX = 10;
export const SPATIAL_QUADRATIC_COMMANDS = 3;
export const DEFAULT_SPATIAL_LINK_MAX_BEND_PX = 24;
export const DEFAULT_SPATIAL_LINK_BEND_RATIO = 0.045;
export const DEFAULT_SPATIAL_LINK_MIN_BEND_PX = 2;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value, fallback) {
  const number = finiteNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function normalize(x, y) {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length, length };
}

function linkHash(from, to) {
  let hash = 0x811c9dc5;
  hash = Math.imul(hash ^ Math.floor(finiteNumber(from)), 0x01000193) >>> 0;
  hash = Math.imul(hash ^ Math.floor(finiteNumber(to)), 0x01000193) >>> 0;
  return hash >>> 0;
}

export function currentLinkSegments(lengthPx) {
  const rawSegments = Math.floor(finiteNumber(lengthPx) / CURRENT_LINK_SEGMENT_PX);
  return Math.max(CURRENT_LINK_MIN_SEGMENTS, Math.min(CURRENT_LINK_MAX_SEGMENTS, rawSegments));
}

export function stableLinkBendSign(from, to) {
  return (linkHash(from, to) & 1) === 0 ? -1 : 1;
}

export function createSpatialQuadraticLink(a, b, {
  from = 0,
  to = 0,
  maxBendPx = DEFAULT_SPATIAL_LINK_MAX_BEND_PX,
  bendRatio = DEFAULT_SPATIAL_LINK_BEND_RATIO,
  minBendPx = DEFAULT_SPATIAL_LINK_MIN_BEND_PX
} = {}) {
  const startX = finiteNumber(a?.x);
  const startY = finiteNumber(a?.y);
  const endX = finiteNumber(b?.x);
  const endY = finiteNumber(b?.y);
  const dx = endX - startX;
  const dy = endY - startY;
  const tangent = normalize(dx, dy);
  const normalX = -tangent.y;
  const normalY = tangent.x;
  const lengthPx = tangent.length;
  const maxBend = positiveNumber(maxBendPx, DEFAULT_SPATIAL_LINK_MAX_BEND_PX);
  const minBend = Math.min(maxBend, positiveNumber(minBendPx, DEFAULT_SPATIAL_LINK_MIN_BEND_PX));
  const ratio = positiveNumber(bendRatio, DEFAULT_SPATIAL_LINK_BEND_RATIO);
  const bendMagnitudePx = lengthPx <= 1
    ? 0
    : Math.min(maxBend, Math.max(minBend, lengthPx * ratio));
  const signedBendPx = bendMagnitudePx * stableLinkBendSign(from, to);
  const midX = (startX + endX) * 0.5;
  const midY = (startY + endY) * 0.5;

  return {
    startX,
    startY,
    controlX: midX + normalX * signedBendPx,
    controlY: midY + normalY * signedBendPx,
    endX,
    endY,
    lengthPx,
    bendPx: signedBendPx,
    visualDeviationPx: Math.abs(signedBendPx) * 0.5,
    commands: SPATIAL_QUADRATIC_COMMANDS
  };
}
