import { LINK_COST_DIAGNOSTIC_MODES } from "../runtime/link-cost-diagnostics.js";
import { summarizeSamples } from "./perf-004-core.js";

export const PERF_010B2A_MODES = LINK_COST_DIAGNOSTIC_MODES;

const LINK_COST_METRICS = [
  "resolvedLinks",
  "missingEndpointLinks",
  "activeLinks",
  "originalSegments",
  "generatedSegments",
  "generatedPoints",
  "pathCommands",
  "strokeCalls",
  "styleWrites",
  "distinctStyles",
  "resolveEndpointsMs",
  "generatePointsMs",
  "buildPathMs",
  "strokeMs",
  "attributedDrawLinksMs",
  "unattributedDrawLinksMs"
];

const BUCKET_METRICS = [
  "links",
  "activeLinks",
  "averageOriginalSegments",
  "averageGeneratedSegments",
  "averageCommands",
  "generatePointsMsPerLink",
  "buildPathMsPerLink",
  "strokeMsPerLink"
];

function stageDuration(profile, name) {
  return (profile.spans || [])
    .filter(span => span.name === name)
    .reduce((total, span) => total + span.durationMs, 0);
}

function markTime(profile, name) {
  return profile.marks?.find(mark => mark.name === name)?.atMs ?? 0;
}

function summarizeContextMetric(profiles, section, name) {
  return summarizeSamples(
    profiles.map(profile => Number(profile.context?.[section]?.[name]) || 0)
  );
}

function summarizeBuckets(profiles) {
  const dimensions = ["length", "segments", "curvature"];
  const result = {};
  for (const dimension of dimensions) {
    result[dimension] = {};
    const names = new Set(
      profiles.flatMap(profile =>
        Object.keys(profile.context?.linkCost?.buckets?.[dimension] || {})
      )
    );
    for (const name of names) {
      result[dimension][name] = {};
      for (const metric of BUCKET_METRICS) {
        result[dimension][name][metric] = summarizeSamples(
          profiles.map(profile =>
            Number(profile.context?.linkCost?.buckets?.[dimension]?.[name]?.[metric]) || 0
          )
        );
      }
    }
  }
  return result;
}

export function summarizePerf010B2AProfiles(profiles) {
  const summary = {
    uiUsableMs: summarizeSamples(profiles.map(profile => markTime(profile, "presentation.uiUsable"))),
    postFrameDelayMs: summarizeSamples(
      profiles.map(profile =>
        Math.max(
          0,
          markTime(profile, "presentation.uiUsable") -
            markTime(profile, "presentation.firstReadyFrameComplete")
        )
      )
    ),
    firstReadyFrameMs: summarizeSamples(
      profiles.map(profile => stageDuration(profile, "presentation.firstReadyFrame.total"))
    ),
    classifyVisibleMs: summarizeSamples(
      profiles.map(profile => stageDuration(profile, "presentation.firstReadyFrame.classifyVisible"))
    ),
    drawLinksMs: summarizeSamples(
      profiles.map(profile => stageDuration(profile, "presentation.firstReadyFrame.drawLinks"))
    ),
    drawnLinks: summarizeContextMetric(profiles, "renderCulling", "drawnLinks"),
    segmentRejectedLinks: summarizeContextMetric(profiles, "renderCulling", "segmentRejectedLinks")
  };
  for (const metric of LINK_COST_METRICS) {
    summary[metric] = summarizeContextMetric(profiles, "linkCost", metric);
  }
  summary.buckets = summarizeBuckets(profiles);
  return summary;
}
