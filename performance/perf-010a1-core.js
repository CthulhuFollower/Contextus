import { rebuildNodesById } from "../runtime/node-index.js";
import { collectVisibleRenderItems } from "../runtime/render-culling.js";
import { migrateLegacyWorkspace } from "../sync/workspace-model.js";
import { createMentalMapDataset } from "./dataset-generator.js";
import { summarizeSamples } from "./perf-004-core.js";

export const PERF_010A1_CAMERAS = ["normal", "dense", "zoom-out", "empty"];
export const PERF_010A1_MODES = ["baseline", "culled"];

export function cameraForPerf010A1(name) {
  if (name === "normal") {
    return { x: 640, y: 360, targetX: 640, targetY: 360, zoom: 3, targetZoom: 3 };
  }
  if (name === "dense") {
    return { x: 640, y: 360, targetX: 640, targetY: 360, zoom: 1, targetZoom: 1 };
  }
  if (name === "zoom-out") {
    return { x: 640, y: 360, targetX: 640, targetY: 360, zoom: 0.36, targetZoom: 0.36 };
  }
  if (name === "empty") {
    return {
      x: -100_000,
      y: -100_000,
      targetX: -100_000,
      targetY: -100_000,
      zoom: 1,
      targetZoom: 1
    };
  }
  throw new RangeError(`Unknown PERF-010A1 camera: ${name}`);
}

export function createPerf010A1Fixture({
  nodeCount,
  cameraName,
  noteSize = 100,
  width = 1_280,
  height = 720
}) {
  if (!PERF_010A1_CAMERAS.includes(cameraName)) {
    throw new RangeError(`Unknown PERF-010A1 camera: ${cameraName}`);
  }
  const { map } = createMentalMapDataset({
    nodeCount,
    shape: "balanced",
    branchingFactor: 4,
    noteSize,
    mapId: 1
  });
  map.camera = cameraForPerf010A1(cameraName);
  map.selectedNodeId = map.nodes.at(-1).id;
  const workspace = {
    version: 7,
    activeMapId: map.id,
    mapIdCounter: map.id,
    mapsView: null,
    maps: [map]
  };
  const migrated = migrateLegacyWorkspace(workspace, {
    workspaceId: `workspace_perf010a1_${nodeCount}_${cameraName}`,
    deviceId: `device_perf010a1_${nodeCount}_${cameraName}`
  });

  return {
    nodeCount,
    cameraName,
    width,
    height,
    workspace,
    sharedSnapshot: migrated.sharedSnapshot,
    deviceSnapshot: migrated.deviceSnapshot,
    map
  };
}

export function classifyPerf010A1Fixture(fixture) {
  const visibleNodes = [];
  const visibleLinks = [];
  return collectVisibleRenderItems({
    nodes: fixture.map.nodes,
    links: fixture.map.links,
    nodesById: rebuildNodesById(fixture.map.nodes),
    camera: fixture.map.camera,
    width: fixture.width,
    height: fixture.height,
    selectedNodeId: fixture.map.selectedNodeId,
    visibleNodes,
    visibleLinks
  });
}

export function summarizePerf010A1Profiles(profiles) {
  const getStage = (profile, name) =>
    (profile.spans || [])
      .filter(span => span.name === name)
      .reduce((total, span) => total + span.durationMs, 0);
  const getMark = (profile, name) =>
    profile.marks?.find(mark => mark.name === name)?.atMs ?? 0;
  const metrics = profiles.map(profile => profile.context?.renderCulling || {});
  return {
    uiUsableMs: summarizeSamples(profiles.map(profile => getMark(profile, "presentation.uiUsable"))),
    firstReadyFrameMs: summarizeSamples(
      profiles.map(profile => getStage(profile, "presentation.firstReadyFrame.total"))
    ),
    classifyVisibleMs: summarizeSamples(
      profiles.map(profile => getStage(profile, "presentation.firstReadyFrame.classifyVisible"))
    ),
    drawLinksMs: summarizeSamples(
      profiles.map(profile => getStage(profile, "presentation.firstReadyFrame.drawLinks"))
    ),
    drawNodesMs: summarizeSamples(
      profiles.map(profile => getStage(profile, "presentation.firstReadyFrame.drawNodes"))
    ),
    drawnNodes: summarizeSamples(metrics.map(value => Number(value.drawnNodes) || 0)),
    drawnLinks: summarizeSamples(metrics.map(value => Number(value.drawnLinks) || 0)),
    totalNodes: metrics[0]?.totalNodes || 0,
    totalLinks: metrics[0]?.totalLinks || 0
  };
}
