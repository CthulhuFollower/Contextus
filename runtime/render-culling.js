const MIN_ZOOM = 0.0001;
const NODE_LABEL_HORIZONTAL_PADDING = 28;
const NODE_LABEL_VERTICAL_PADDING = 20;
const LINK_BASE_PADDING = 72;
const LINK_SEGMENT_BASE_PADDING = 12;
const LINK_CURVE_VELOCITY_PADDING = 24;

function projectWorldPoint(x, y, camera) {
  return {
    x: x * camera.zoom + camera.x,
    y: y * camera.zoom + camera.y
  };
}

function boundsIntersectViewport(left, top, right, bottom, viewport) {
  return (
    left <= viewport.right &&
    right >= viewport.left &&
    top <= viewport.bottom &&
    bottom >= viewport.top
  );
}

function segmentIntersectsBounds(ax, ay, bx, by, left, top, right, bottom) {
  const dx = bx - ax;
  const dy = by - ay;
  let minimumT = 0;
  let maximumT = 1;

  if (dx === 0) {
    if (ax < left || ax > right) return false;
  } else {
    const firstX = (left - ax) / dx;
    const secondX = (right - ax) / dx;
    minimumT = Math.max(minimumT, Math.min(firstX, secondX));
    maximumT = Math.min(maximumT, Math.max(firstX, secondX));
    if (minimumT > maximumT) return false;
  }

  if (dy === 0) return ay >= top && ay <= bottom;
  const firstY = (top - ay) / dy;
  const secondY = (bottom - ay) / dy;
  minimumT = Math.max(minimumT, Math.min(firstY, secondY));
  maximumT = Math.min(maximumT, Math.max(firstY, secondY));
  return minimumT <= maximumT;
}

export function createScreenViewport(width, height) {
  return {
    left: 0,
    top: 0,
    right: Math.max(0, Number(width) || 0),
    bottom: Math.max(0, Number(height) || 0)
  };
}

export function getConservativeNodeScreenBounds(node, camera, selectedNodeId = null) {
  const zoom = Math.max(Number(camera?.zoom) || 1, MIN_ZOOM);
  const point = projectWorldPoint(node.renderX, node.renderY, camera);
  const selected = node.id === selectedNodeId;
  const visualRadius = Math.max(0, Number(node.visualRadius) || 0);
  const scaledRadius = visualRadius * zoom;
  const ordinaryAura = scaledRadius + (selected ? 16 * zoom : 4 * zoom);
  // The center star has large animated halos and optional WebGL bloom.
  const bodyRadius = node.isCenter
    ? Math.max(ordinaryAura, scaledRadius * 20)
    : ordinaryAura;
  const labelScale = Math.min(1.9, Math.max(0.6, Math.pow(zoom, 0.86)));
  const labelCharacters = selected ? 22 : 18;
  const labelFontSize = (selected ? 13 : 12) * labelScale;
  const labelHalfWidth =
    labelCharacters * labelFontSize * 0.8 * 0.5 + NODE_LABEL_HORIZONTAL_PADDING;
  const labelBottom =
    bodyRadius + 18 * labelScale + labelFontSize + NODE_LABEL_VERTICAL_PADDING;

  return {
    left: point.x - Math.max(bodyRadius, labelHalfWidth),
    right: point.x + Math.max(bodyRadius, labelHalfWidth),
    top: point.y - bodyRadius,
    bottom: point.y + Math.max(bodyRadius, labelBottom)
  };
}

export function isNodePotentiallyVisible(node, camera, viewport, selectedNodeId = null) {
  const zoom = Math.max(Number(camera?.zoom) || 1, MIN_ZOOM);
  const x = node.renderX * zoom + camera.x;
  const y = node.renderY * zoom + camera.y;
  const selected = node.id === selectedNodeId;
  const visualRadius = Math.max(0, Number(node.visualRadius) || 0);
  const scaledRadius = visualRadius * zoom;
  const ordinaryAura = scaledRadius + (selected ? 16 * zoom : 4 * zoom);
  const bodyRadius = node.isCenter
    ? Math.max(ordinaryAura, scaledRadius * 20)
    : ordinaryAura;
  const labelScale = Math.min(1.9, Math.max(0.6, Math.pow(zoom, 0.86)));
  const labelCharacters = selected ? 22 : 18;
  const labelFontSize = (selected ? 13 : 12) * labelScale;
  const labelHalfWidth =
    labelCharacters * labelFontSize * 0.8 * 0.5 + NODE_LABEL_HORIZONTAL_PADDING;
  const horizontalRadius = Math.max(bodyRadius, labelHalfWidth);
  const labelBottom =
    bodyRadius + 18 * labelScale + labelFontSize + NODE_LABEL_VERTICAL_PADDING;

  return boundsIntersectViewport(
    x - horizontalRadius,
    y - bodyRadius,
    x + horizontalRadius,
    y + Math.max(bodyRadius, labelBottom),
    viewport
  );
}

export function getConservativeLinkScreenBounds(aNode, bNode, camera) {
  const zoom = Math.max(Number(camera?.zoom) || 1, MIN_ZOOM);
  const a = projectWorldPoint(aNode.renderX, aNode.renderY, camera);
  const b = projectWorldPoint(bNode.renderX, bNode.renderY, camera);
  const maximumVelocity = Math.max(
    Math.abs(Number(aNode.vx) || 0) + Math.abs(Number(aNode.vy) || 0),
    Math.abs(Number(bNode.vx) || 0) + Math.abs(Number(bNode.vy) || 0)
  ) * zoom;
  const padding = LINK_BASE_PADDING + maximumVelocity * 24 + zoom * 4;

  return {
    left: Math.min(a.x, b.x) - padding,
    right: Math.max(a.x, b.x) + padding,
    top: Math.min(a.y, b.y) - padding,
    bottom: Math.max(a.y, b.y) + padding
  };
}

export function isLinkPotentiallyVisible(aNode, bNode, camera, viewport) {
  const zoom = Math.max(Number(camera?.zoom) || 1, MIN_ZOOM);
  const ax = aNode.renderX * zoom + camera.x;
  const ay = aNode.renderY * zoom + camera.y;
  const bx = bNode.renderX * zoom + camera.x;
  const by = bNode.renderY * zoom + camera.y;
  const maximumVelocity = Math.max(
    Math.abs(Number(aNode.vx) || 0) + Math.abs(Number(aNode.vy) || 0),
    Math.abs(Number(bNode.vx) || 0) + Math.abs(Number(bNode.vy) || 0)
  ) * zoom;
  const padding = LINK_BASE_PADDING + maximumVelocity * 24 + zoom * 4;

  return boundsIntersectViewport(
    Math.min(ax, bx) - padding,
    Math.min(ay, by) - padding,
    Math.max(ax, bx) + padding,
    Math.max(ay, by) + padding,
    viewport
  );
}

export function getConservativeLinkSegmentMargin(aNode, bNode, camera) {
  const zoom = Math.max(Number(camera?.zoom) || 1, MIN_ZOOM);
  const maximumVelocity = Math.max(
    Math.abs(Number(aNode.vx) || 0) + Math.abs(Number(aNode.vy) || 0),
    Math.abs(Number(bNode.vx) || 0) + Math.abs(Number(bNode.vy) || 0)
  ) * zoom;
  return (
    LINK_SEGMENT_BASE_PADDING +
    maximumVelocity * LINK_CURVE_VELOCITY_PADDING +
    zoom * 4
  );
}

export function isLinkSegmentPotentiallyVisible(aNode, bNode, camera, viewport) {
  const zoom = Math.max(Number(camera?.zoom) || 1, MIN_ZOOM);
  const ax = aNode.renderX * zoom + camera.x;
  const ay = aNode.renderY * zoom + camera.y;
  const bx = bNode.renderX * zoom + camera.x;
  const by = bNode.renderY * zoom + camera.y;
  const margin = getConservativeLinkSegmentMargin(aNode, bNode, camera);
  return segmentIntersectsBounds(
    ax,
    ay,
    bx,
    by,
    viewport.left - margin,
    viewport.top - margin,
    viewport.right + margin,
    viewport.bottom + margin
  );
}

export function collectVisibleRenderItems({
  nodes,
  links,
  nodesById,
  camera,
  width,
  height,
  selectedNodeId = null,
  visibleNodes = [],
  visibleLinks = [],
  linkDiagnostics = null,
  linkSegmentCulling = false
}) {
  const viewport = createScreenViewport(width, height);
  visibleNodes.length = 0;
  visibleLinks.length = 0;

  const nodeClassificationStarted = linkDiagnostics?.startStage();
  for (const node of nodes) {
    if (isNodePotentiallyVisible(node, camera, viewport, selectedNodeId)) {
      visibleNodes.push(node);
    }
  }
  if (linkDiagnostics) {
    linkDiagnostics.endStage("classifyNodesMs", nodeClassificationStarted);
  }

  const linkSelectionStarted = linkDiagnostics?.startStage();
  let boundingBoxLinks = 0;
  let segmentRejectedLinks = 0;
  for (const link of links) {
    const aNode = nodesById.get(link.from);
    const bNode = nodesById.get(link.to);
    if (!aNode || !bNode || !isLinkPotentiallyVisible(aNode, bNode, camera, viewport)) continue;
    boundingBoxLinks += 1;
    if (
      linkSegmentCulling &&
      !isLinkSegmentPotentiallyVisible(aNode, bNode, camera, viewport)
    ) {
      segmentRejectedLinks += 1;
      continue;
    }
    visibleLinks.push(link);
  }
  if (linkDiagnostics) {
    linkDiagnostics.endStage("selectCandidatesMs", linkSelectionStarted);
    linkDiagnostics.recordCandidates(links.length, visibleLinks.length);
  }

  return {
    visibleNodes,
    visibleLinks,
    metrics: {
      totalNodes: nodes.length,
      totalLinks: links.length,
      consideredNodes: nodes.length,
      consideredLinks: links.length,
      drawnNodes: visibleNodes.length,
      drawnLinks: visibleLinks.length,
      boundingBoxLinks,
      segmentRejectedLinks,
      linkCullingMode: linkSegmentCulling ? "segment" : "bounding-box"
    }
  };
}
