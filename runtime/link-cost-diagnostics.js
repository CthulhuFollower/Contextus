export const LINK_COST_DIAGNOSTIC_MODES = [
  "current",
  "points-only",
  "path-no-stroke",
  "straight",
  "reduced-segments",
  "uniform-batch",
  "no-active"
];

const STAGES = [
  "resolveEndpointsMs",
  "generatePointsMs",
  "buildPathMs",
  "strokeMs"
];

function defaultClock() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function emptyBucket() {
  return {
    links: 0,
    activeLinks: 0,
    originalSegments: 0,
    generatedSegments: 0,
    commands: 0,
    resolveEndpointsMs: 0,
    generatePointsMs: 0,
    buildPathMs: 0,
    strokeMs: 0
  };
}

function createBuckets(names) {
  return Object.fromEntries(names.map(name => [name, emptyBucket()]));
}

function lengthBucket(lengthPx) {
  if (lengthPx < 25) return "lt25";
  if (lengthPx < 100) return "25-100";
  if (lengthPx < 500) return "100-500";
  return "gte500";
}

function segmentBucket(segments) {
  if (segments === 18) return "18";
  if (segments < 30) return "19-29";
  if (segments < 42) return "30-41";
  return "42";
}

function curvatureBucket(curvaturePx) {
  if (curvaturePx < 2) return "lt2";
  if (curvaturePx < 12) return "2-12";
  return "gte12";
}

function enrichBucket(bucket) {
  return {
    ...bucket,
    averageOriginalSegments: bucket.links > 0 ? bucket.originalSegments / bucket.links : 0,
    averageGeneratedSegments: bucket.links > 0 ? bucket.generatedSegments / bucket.links : 0,
    averageCommands: bucket.links > 0 ? bucket.commands / bucket.links : 0,
    generatePointsMsPerLink: bucket.links > 0 ? bucket.generatePointsMs / bucket.links : 0,
    buildPathMsPerLink: bucket.links > 0 ? bucket.buildPathMs / bucket.links : 0,
    strokeMsPerLink: bucket.links > 0 ? bucket.strokeMs / bucket.links : 0
  };
}

function enrichBuckets(buckets) {
  return Object.fromEntries(
    Object.entries(buckets).map(([name, bucket]) => [name, enrichBucket(bucket)])
  );
}

export function createLinkCostDiagnostics({
  mode = "current",
  clock = defaultClock
} = {}) {
  if (!LINK_COST_DIAGNOSTIC_MODES.includes(mode)) {
    throw new RangeError(`Unknown link cost diagnostic mode: ${mode}`);
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
    styleWrites: 0
  };
  const styles = new Set();
  const buckets = {
    length: createBuckets(["lt25", "25-100", "100-500", "gte500"]),
    segments: createBuckets(["18", "19-29", "30-41", "42"]),
    curvature: createBuckets(["lt2", "2-12", "gte12"])
  };

  function bucketReferences(descriptor) {
    if (!descriptor) return [];
    return [
      buckets.length[descriptor.lengthBucket],
      buckets.segments[descriptor.segmentBucket],
      buckets.curvature[descriptor.curvatureBucket]
    ];
  }

  return {
    mode,
    clock,
    startStage() {
      return clock();
    },
    endStage(stage, startedAt, descriptor = null) {
      const duration = clock() - startedAt;
      durations[stage] += duration;
      for (const bucket of bucketReferences(descriptor)) {
        bucket[stage] += duration;
      }
      return duration;
    },
    recordResolvedLink({ lengthPx, originalSegments, curvaturePx, active }) {
      const descriptor = {
        lengthBucket: lengthBucket(lengthPx),
        segmentBucket: segmentBucket(originalSegments),
        curvatureBucket: curvatureBucket(curvaturePx)
      };
      metrics.resolvedLinks += 1;
      metrics.originalSegments += originalSegments;
      if (active) metrics.activeLinks += 1;
      for (const bucket of bucketReferences(descriptor)) {
        bucket.links += 1;
        bucket.originalSegments += originalSegments;
        if (active) bucket.activeLinks += 1;
      }
      return descriptor;
    },
    recordMissingEndpoint() {
      metrics.missingEndpointLinks += 1;
    },
    recordGeneratedGeometry(descriptor, segments) {
      metrics.generatedSegments += segments;
      metrics.generatedPoints += segments + 1;
      for (const bucket of bucketReferences(descriptor)) {
        bucket.generatedSegments += segments;
      }
    },
    recordPath(descriptor, commands) {
      metrics.pathCommands += commands;
      for (const bucket of bucketReferences(descriptor)) {
        bucket.commands += commands;
      }
    },
    recordStroke(descriptor = null, calls = 1) {
      metrics.strokeCalls += calls;
      if (descriptor) {
        for (const bucket of bucketReferences(descriptor)) {
          bucket.strokeMs += 0;
        }
      }
    },
    recordStyle(style, writes = 2) {
      styles.add(style);
      metrics.styleWrites += writes;
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
        buckets: {
          length: enrichBuckets(buckets.length),
          segments: enrichBuckets(buckets.segments),
          curvature: enrichBuckets(buckets.curvature)
        }
      };
    }
  };
}
