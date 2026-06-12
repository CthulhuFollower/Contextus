function defaultClock() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function pointInsideViewport(point, viewport) {
  return (
    point.x >= viewport.left &&
    point.x <= viewport.right &&
    point.y >= viewport.top &&
    point.y <= viewport.bottom
  );
}

function orientation(ax, ay, bx, by, cx, cy) {
  return (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
}

function onSegment(ax, ay, bx, by, cx, cy) {
  return (
    bx >= Math.min(ax, cx) &&
    bx <= Math.max(ax, cx) &&
    by >= Math.min(ay, cy) &&
    by <= Math.max(ay, cy)
  );
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a.x, a.y, b.x, b.y, c.x, c.y);
  const o2 = orientation(a.x, a.y, b.x, b.y, d.x, d.y);
  const o3 = orientation(c.x, c.y, d.x, d.y, a.x, a.y);
  const o4 = orientation(c.x, c.y, d.x, d.y, b.x, b.y);

  if ((o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)) return true;
  if (o1 === 0 && onSegment(a.x, a.y, c.x, c.y, b.x, b.y)) return true;
  if (o2 === 0 && onSegment(a.x, a.y, d.x, d.y, b.x, b.y)) return true;
  if (o3 === 0 && onSegment(c.x, c.y, a.x, a.y, d.x, d.y)) return true;
  return o4 === 0 && onSegment(c.x, c.y, b.x, b.y, d.x, d.y);
}

export function createExpandedViewport(width, height, margin = 0) {
  const safeMargin = Math.max(0, Number(margin) || 0);
  return {
    left: -safeMargin,
    top: -safeMargin,
    right: Math.max(0, Number(width) || 0) + safeMargin,
    bottom: Math.max(0, Number(height) || 0) + safeMargin
  };
}

export function polylineIntersectsViewport(points, viewport) {
  if (!Array.isArray(points) || points.length === 0) return false;
  const topLeft = { x: viewport.left, y: viewport.top };
  const topRight = { x: viewport.right, y: viewport.top };
  const bottomRight = { x: viewport.right, y: viewport.bottom };
  const bottomLeft = { x: viewport.left, y: viewport.bottom };

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (pointInsideViewport(point, viewport)) return true;
    if (index === 0) continue;
    const previous = points[index - 1];
    if (
      segmentsIntersect(previous, point, topLeft, topRight) ||
      segmentsIntersect(previous, point, topRight, bottomRight) ||
      segmentsIntersect(previous, point, bottomRight, bottomLeft) ||
      segmentsIntersect(previous, point, bottomLeft, topLeft)
    ) {
      return true;
    }
  }
  return false;
}

export function createLinkRenderDiagnostics({
  width,
  height,
  zoom = 1,
  clock = defaultClock
}) {
  const viewport = createExpandedViewport(width, height, Math.max(8, 6 * zoom));
  const durations = {
    classifyNodesMs: 0,
    selectCandidatesMs: 0,
    resolveEndpointsMs: 0,
    generatePointsMs: 0,
    visibilityProbeMs: 0,
    buildMainPathMs: 0,
    strokeMainMs: 0,
    buildActivePathMs: 0,
    strokeActiveMs: 0
  };
  const metrics = {
    totalLinks: 0,
    candidateLinks: 0,
    resolvedLinks: 0,
    missingEndpointLinks: 0,
    sampledVisibleLinks: 0,
    sampledInvisibleLinks: 0,
    sampledVisibleSegments: 0,
    sampledInvisibleSegments: 0,
    activeLinks: 0,
    generatedPoints: 0,
    generatedSegments: 0,
    mainPathCommands: 0,
    activePathCommands: 0,
    mainStrokeCalls: 0,
    activeStrokeCalls: 0,
    minimumSegments: null,
    maximumSegments: 0
  };

  return {
    clock,
    viewport,
    durations,
    metrics,
    startStage() {
      return clock();
    },
    endStage(stage, startedAt) {
      durations[stage] += clock() - startedAt;
    },
    recordCandidates(totalLinks, candidateLinks) {
      metrics.totalLinks = totalLinks;
      metrics.candidateLinks = candidateLinks;
    },
    recordResolvedLink(segments, active) {
      metrics.resolvedLinks += 1;
      if (active) metrics.activeLinks += 1;
      metrics.generatedSegments += segments;
      metrics.generatedPoints += segments + 1;
      metrics.minimumSegments =
        metrics.minimumSegments === null ? segments : Math.min(metrics.minimumSegments, segments);
      metrics.maximumSegments = Math.max(metrics.maximumSegments, segments);
    },
    recordMissingEndpoint() {
      metrics.missingEndpointLinks += 1;
    },
    recordSampledVisibility(visible, segments = 0) {
      if (visible) {
        metrics.sampledVisibleLinks += 1;
        metrics.sampledVisibleSegments += segments;
      } else {
        metrics.sampledInvisibleLinks += 1;
        metrics.sampledInvisibleSegments += segments;
      }
    },
    recordMainPath(segments) {
      metrics.mainPathCommands += segments + 2;
      metrics.mainStrokeCalls += 1;
    },
    recordActivePath(segments) {
      metrics.activePathCommands += segments + 2;
      metrics.activeStrokeCalls += 1;
    },
    snapshot(totalDrawLinksMs = 0) {
      const attributedMs = Object.entries(durations)
        .filter(([name]) => name !== "classifyNodesMs" && name !== "selectCandidatesMs")
        .reduce((total, [, duration]) => total + duration, 0);
      return {
        ...metrics,
        ...durations,
        candidateToSampledVisibleRatio:
          metrics.sampledVisibleLinks > 0
            ? metrics.candidateLinks / metrics.sampledVisibleLinks
            : metrics.candidateLinks === 0 ? 1 : null,
        attributedDrawLinksMs: attributedMs,
        unattributedDrawLinksMs: Math.max(0, totalDrawLinksMs - attributedMs)
      };
    }
  };
}
