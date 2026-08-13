import {
  SPATIAL_QUADRATIC_COMMANDS
} from "./link-adaptive-geometry.js";

export {
  SPATIAL_QUADRATIC_COMMANDS,
  createSpatialQuadraticLink,
  currentLinkSegments
} from "./link-adaptive-geometry.js";

export const LINK_ADAPTIVE_DIAGNOSTIC_MODES = ["spatial-quad"];

const STAGES = [
  "resolveEndpointsMs",
  "generateGeometryMs",
  "buildPathMs",
  "strokeMs"
];

function defaultClock() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function emptySummary() {
  return { count: 0, average: 0, p50: 0, p95: 0, max: 0 };
}

function summarizeValues(values) {
  if (!values.length) return emptySummary();
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (ratio) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
  return {
    count: sorted.length,
    average: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted[sorted.length - 1]
  };
}

export function createLinkAdaptiveDiagnostics({
  mode = "spatial-quad",
  clock = defaultClock
} = {}) {
  if (!LINK_ADAPTIVE_DIAGNOSTIC_MODES.includes(mode)) {
    throw new RangeError(`Unknown link adaptive diagnostic mode: ${mode}`);
  }

  const durations = Object.fromEntries(STAGES.map(stage => [stage, 0]));
  const metrics = {
    mode,
    resolvedLinks: 0,
    missingEndpointLinks: 0,
    activeLinks: 0,
    originalSegments: 0,
    generatedSegments: 0,
    generatedPoints: 0,
    pathCommands: 0,
    strokeCalls: 0,
    styleWrites: 0,
    distinctStyles: 0,
    spatialQuadraticLinks: 0,
    savedSegments: 0,
    savedPathCommands: 0
  };
  const styles = new Set();
  const bendSamples = [];
  const visualDeviationSamples = [];

  return {
    mode,
    clock,
    startStage() {
      return clock();
    },
    endStage(stage, startedAt) {
      durations[stage] += clock() - startedAt;
    },
    recordResolvedLink({ originalSegments, active }) {
      const descriptor = {
        originalSegments: Math.max(1, Math.floor(Number(originalSegments) || 1)),
        active: Boolean(active)
      };
      metrics.resolvedLinks += 1;
      metrics.originalSegments += descriptor.originalSegments;
      if (descriptor.active) metrics.activeLinks += 1;
      return descriptor;
    },
    recordMissingEndpoint() {
      metrics.missingEndpointLinks += 1;
    },
    recordSpatialQuadraticGeometry(descriptor, geometry) {
      metrics.spatialQuadraticLinks += 1;
      metrics.generatedSegments += 1;
      metrics.generatedPoints += 3;
      metrics.savedSegments += Math.max(0, descriptor.originalSegments - 1);
      metrics.savedPathCommands += Math.max(
        0,
        descriptor.originalSegments + 2 - SPATIAL_QUADRATIC_COMMANDS
      );
      bendSamples.push(Math.abs(Number(geometry?.bendPx) || 0));
      visualDeviationSamples.push(Number(geometry?.visualDeviationPx) || 0);
      return descriptor;
    },
    recordPath(commands) {
      metrics.pathCommands += Math.max(0, Math.floor(Number(commands) || 0));
    },
    recordStroke(calls = 1) {
      metrics.strokeCalls += Math.max(0, Math.floor(Number(calls) || 0));
    },
    recordStyle(style, writes = 2) {
      styles.add(style);
      metrics.styleWrites += Math.max(0, Math.floor(Number(writes) || 0));
    },
    snapshot(totalDrawLinksMs = 0) {
      const attributedDrawLinksMs = Object.values(durations)
        .reduce((total, duration) => total + duration, 0);
      return {
        ...metrics,
        ...durations,
        distinctStyles: styles.size,
        attributedDrawLinksMs,
        unattributedDrawLinksMs: Math.max(0, totalDrawLinksMs - attributedDrawLinksMs),
        bendPx: summarizeValues(bendSamples),
        visualDeviationPx: summarizeValues(visualDeviationSamples)
      };
    }
  };
}
