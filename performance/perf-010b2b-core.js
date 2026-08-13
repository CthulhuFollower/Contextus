import { LINK_ADAPTIVE_DIAGNOSTIC_MODES } from "../runtime/link-adaptive-diagnostics.js";
import { summarizeSamples } from "./perf-004-core.js";

export const PERF_010B2B_MODES = LINK_ADAPTIVE_DIAGNOSTIC_MODES;
export const PERF_010B2B_VELOCITY_FIXTURES = ["none", "medium", "high"];

const LINK_ADAPTIVE_METRICS = [
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
  "spatialQuadraticLinks",
  "savedSegments",
  "savedPathCommands",
  "resolveEndpointsMs",
  "generateGeometryMs",
  "buildPathMs",
  "strokeMs",
  "attributedDrawLinksMs",
  "unattributedDrawLinksMs"
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

function summarizeNestedLinkAdaptiveMetric(profiles, name, statistic) {
  return summarizeSamples(
    profiles.map(profile => Number(profile.context?.linkAdaptive?.[name]?.[statistic]) || 0)
  );
}

export function summarizePerf010B2BProfiles(profiles) {
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

  for (const metric of LINK_ADAPTIVE_METRICS) {
    summary[metric] = summarizeContextMetric(profiles, "linkAdaptive", metric);
  }

  summary.bendPxP95 = summarizeNestedLinkAdaptiveMetric(profiles, "bendPx", "p95");
  summary.visualDeviationPxP95 = summarizeNestedLinkAdaptiveMetric(
    profiles,
    "visualDeviationPx",
    "p95"
  );
  summary.visualDeviationPxMax = summarizeNestedLinkAdaptiveMetric(
    profiles,
    "visualDeviationPx",
    "max"
  );

  return summary;
}
