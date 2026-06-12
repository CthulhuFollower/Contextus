import { summarizeSamples } from "./perf-004-core.js";

export const PERF_010B1_MODES = ["a1", "b1"];

function stageDuration(profile, name) {
  return (profile.spans || [])
    .filter(span => span.name === name)
    .reduce((total, span) => total + span.durationMs, 0);
}

function markTime(profile, name) {
  return profile.marks?.find(mark => mark.name === name)?.atMs ?? 0;
}

function summarizeRenderMetric(profiles, name) {
  return summarizeSamples(
    profiles.map(profile => Number(profile.context?.renderCulling?.[name]) || 0)
  );
}

export function summarizePerf010B1Profiles(profiles) {
  return {
    uiUsableMs: summarizeSamples(profiles.map(profile => markTime(profile, "presentation.uiUsable"))),
    firstReadyFrameMs: summarizeSamples(
      profiles.map(profile => stageDuration(profile, "presentation.firstReadyFrame.total"))
    ),
    classifyVisibleMs: summarizeSamples(
      profiles.map(profile => stageDuration(profile, "presentation.firstReadyFrame.classifyVisible"))
    ),
    drawLinksMs: summarizeSamples(
      profiles.map(profile => stageDuration(profile, "presentation.firstReadyFrame.drawLinks"))
    ),
    drawNodesMs: summarizeSamples(
      profiles.map(profile => stageDuration(profile, "presentation.firstReadyFrame.drawNodes"))
    ),
    boundingBoxLinks: summarizeRenderMetric(profiles, "boundingBoxLinks"),
    segmentRejectedLinks: summarizeRenderMetric(profiles, "segmentRejectedLinks"),
    drawnLinks: summarizeRenderMetric(profiles, "drawnLinks")
  };
}
