import { summarizeSamples } from "./perf-004-core.js";

function stageDuration(profile, name) {
  return (profile.spans || [])
    .filter(span => span.name === name)
    .reduce((total, span) => total + span.durationMs, 0);
}

function markTime(profile, name) {
  return profile.marks?.find(mark => mark.name === name)?.atMs ?? 0;
}

function summarizeMetric(profiles, name) {
  return summarizeSamples(
    profiles.map(profile => Number(profile.context?.linkRender?.[name]) || 0)
  );
}

export function summarizePerf010B0Profiles(profiles) {
  return {
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
    classifyNodesMs: summarizeMetric(profiles, "classifyNodesMs"),
    selectCandidatesMs: summarizeMetric(profiles, "selectCandidatesMs"),
    resolveEndpointsMs: summarizeMetric(profiles, "resolveEndpointsMs"),
    generatePointsMs: summarizeMetric(profiles, "generatePointsMs"),
    visibilityProbeMs: summarizeMetric(profiles, "visibilityProbeMs"),
    buildMainPathMs: summarizeMetric(profiles, "buildMainPathMs"),
    strokeMainMs: summarizeMetric(profiles, "strokeMainMs"),
    buildActivePathMs: summarizeMetric(profiles, "buildActivePathMs"),
    strokeActiveMs: summarizeMetric(profiles, "strokeActiveMs"),
    attributedDrawLinksMs: summarizeMetric(profiles, "attributedDrawLinksMs"),
    unattributedDrawLinksMs: summarizeMetric(profiles, "unattributedDrawLinksMs"),
    candidateLinks: summarizeMetric(profiles, "candidateLinks"),
    sampledVisibleLinks: summarizeMetric(profiles, "sampledVisibleLinks"),
    sampledInvisibleLinks: summarizeMetric(profiles, "sampledInvisibleLinks"),
    sampledVisibleSegments: summarizeMetric(profiles, "sampledVisibleSegments"),
    sampledInvisibleSegments: summarizeMetric(profiles, "sampledInvisibleSegments"),
    candidateToSampledVisibleRatio: summarizeMetric(profiles, "candidateToSampledVisibleRatio"),
    generatedPoints: summarizeMetric(profiles, "generatedPoints"),
    generatedSegments: summarizeMetric(profiles, "generatedSegments"),
    mainPathCommands: summarizeMetric(profiles, "mainPathCommands"),
    mainStrokeCalls: summarizeMetric(profiles, "mainStrokeCalls")
  };
}
