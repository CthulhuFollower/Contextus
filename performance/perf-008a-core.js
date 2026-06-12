import { cloneValue } from "../sync/workspace-model.js";
import {
  PERF_007B_SCENARIOS,
  createPerf007BFixture
} from "./perf-007b-core.js";

export const PERF_008A_SCENARIOS = PERF_007B_SCENARIOS;

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, canonicalValue(value[key])])
  );
}

export function sameStructuredValue(left, right) {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

export function createPerf008AFixture(options) {
  return createPerf007BFixture({
    ...options,
    workspaceId: options.workspaceId || `workspace_perf008a_${options.nodeCount}`,
    deviceId: options.deviceId || `device_perf008a_${options.nodeCount}`
  });
}

export function nextPrivatePatch(patch, sequence = 1) {
  if (patch.type === "setMapCamera") {
    return {
      ...cloneValue(patch),
      camera: {
        x: 200 + sequence,
        y: -100 - sequence,
        targetX: 205 + sequence,
        targetY: -95 - sequence,
        zoom: 2.5 + sequence / 1_000,
        targetZoom: 2.6 + sequence / 1_000
      }
    };
  }
  if (patch.type === "setSelectedNode") {
    return { ...cloneValue(patch), selectedNodeSyncId: null };
  }
  if (patch.type === "setConstellationView") {
    return {
      ...cloneValue(patch),
      view: {
        x: 70 + sequence,
        y: -50 - sequence,
        targetX: 72 + sequence,
        targetY: -48 - sequence,
        zoom: 2 + sequence / 1_000,
        targetZoom: 2.1 + sequence / 1_000
      }
    };
  }
  return {
    ...cloneValue(patch),
    activeMapSyncId: patch.activeMapSyncId === "map-perf008a-alternate"
      ? "map-perf008a-primary"
      : "map-perf008a-alternate"
  };
}

export async function runPerf008AReplacement(engine, fixture) {
  await engine.recordDevicePatches([fixture.patch]);
  const replacement = nextPrivatePatch(fixture.patch, 1);
  const startedAt = performance.now();
  const result = await engine.recordDevicePatches([replacement]);
  const commitCompleteMs = performance.now() - startedAt;
  return {
    commitCompleteMs,
    logicalBytesWritten: result.persistence?.logicalBytesWritten || 0,
    patchCount: engine.devicePatches.length,
    patchBytes: engine.privatePatchLogBytes,
    revision: engine.privateRevision,
    exact: JSON.stringify(engine.deviceSnapshot) !== JSON.stringify(fixture.initialDeviceSnapshot)
  };
}

export function privateGrowthPatch(pattern, index) {
  const mapIndex = index % 3;
  const mapSyncId = `map-perf008a-${mapIndex}`;
  if (pattern === "same-map-camera") {
    return {
      type: "setMapCamera",
      mapSyncId: "map-perf008a-0",
      camera: { x: index, y: -index, zoom: 1 + index / 1_000 }
    };
  }
  if (pattern === "three-map-camera") {
    return {
      type: "setMapCamera",
      mapSyncId,
      camera: { x: index, y: -index, zoom: 1 + index / 1_000 }
    };
  }

  const slot = index % 8;
  if (slot < 3) {
    return {
      type: "setMapCamera",
      mapSyncId: `map-perf008a-${slot}`,
      camera: { x: index, y: -index, zoom: 1 + index / 1_000 }
    };
  }
  if (slot < 6) {
    return {
      type: "setSelectedNode",
      mapSyncId: `map-perf008a-${slot - 3}`,
      selectedNodeSyncId: index % 2 ? `node-perf008a-${index}` : null
    };
  }
  if (slot === 6) {
    return { type: "setActiveMap", activeMapSyncId: mapSyncId };
  }
  return {
    type: "setConstellationView",
    view: { x: index, y: -index, zoom: 1 + index / 1_000 }
  };
}
