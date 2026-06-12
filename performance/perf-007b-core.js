import {
  captureDeviceSnapshot,
  cloneValue,
  materializeWorkspace,
  migrateLegacyWorkspace
} from "../sync/workspace-model.js";
import {
  createMemoryEngineForPerf004,
  createPerf004Fixture
} from "./perf-004-core.js";

export const PERF_007B_SCENARIOS = [
  "select-node",
  "map-camera",
  "constellation-view",
  "active-map"
];

function secondaryMap(nodeCount) {
  return {
    id: 2,
    syncId: `map_perf007b_secondary_${nodeCount}`,
    nodeIdCounter: 1,
    selectedNodeId: 1,
    constellationPosition: { x: 300, y: -150 },
    camera: { x: 0, y: 0, targetX: 0, targetY: 0, zoom: 1, targetZoom: 1 },
    nodes: [{
      id: 1,
      syncId: `node_perf007b_secondary_${nodeCount}`,
      parentId: null,
      parentSyncId: null,
      level: 0,
      isCenter: true,
      label: "Secundario",
      note: "",
      x: 0,
      y: 0
    }],
    links: []
  };
}

export function createPerf007BFixture({
  nodeCount,
  scenario,
  noteSize = 100,
  workspaceId = `workspace_perf007b_${nodeCount}`,
  deviceId = `device_perf007b_${nodeCount}`
}) {
  if (!PERF_007B_SCENARIOS.includes(scenario)) {
    throw new RangeError(`Unknown PERF-007B scenario: ${scenario}`);
  }

  const base = createPerf004Fixture({ nodeCount, scenario: "edit-text", noteSize });
  const initialWorkspace = materializeWorkspace(
    base.initialSharedSnapshot,
    base.initialDeviceSnapshot
  ).state;
  initialWorkspace.maps.push(secondaryMap(nodeCount));
  initialWorkspace.mapIdCounter = 2;
  const migrated = migrateLegacyWorkspace(initialWorkspace, { workspaceId, deviceId });
  const mutatedWorkspace = cloneValue(initialWorkspace);
  const map = mutatedWorkspace.maps[0];
  let patch;

  if (scenario === "select-node") {
    map.selectedNodeId = map.nodes[0].id;
    patch = {
      type: "setSelectedNode",
      mapSyncId: map.syncId,
      selectedNodeSyncId: map.nodes[0].syncId
    };
  }

  if (scenario === "map-camera") {
    map.camera = {
      x: 187,
      y: -93,
      targetX: 201,
      targetY: -88,
      zoom: 2.4,
      targetZoom: 2.5
    };
    patch = { type: "setMapCamera", mapSyncId: map.syncId, camera: cloneValue(map.camera) };
  }

  if (scenario === "constellation-view") {
    mutatedWorkspace.mapsView = {
      x: 57,
      y: -41,
      targetX: 60,
      targetY: -39,
      zoom: 1.8,
      targetZoom: 1.9
    };
    patch = { type: "setConstellationView", view: cloneValue(mutatedWorkspace.mapsView) };
  }

  if (scenario === "active-map") {
    mutatedWorkspace.activeMapId = 2;
    patch = {
      type: "setActiveMap",
      activeMapSyncId: mutatedWorkspace.maps[1].syncId
    };
  }

  return {
    nodeCount,
    scenario,
    noteSize,
    initialWorkspace,
    mutatedWorkspace,
    initialSharedSnapshot: migrated.sharedSnapshot,
    initialDeviceSnapshot: migrated.deviceSnapshot,
    patch
  };
}

export async function createMemoryEngineForPerf007B(fixture) {
  return createMemoryEngineForPerf004(fixture);
}

function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function observablePrivateState(deviceSnapshot, patch) {
  if (patch.type === "setActiveMap") return deviceSnapshot.activeMapSyncId;
  if (patch.type === "setSelectedNode") {
    return deviceSnapshot.mapStates[patch.mapSyncId]?.selectedNodeSyncId ?? null;
  }
  if (patch.type === "setMapCamera") {
    return cloneValue(deviceSnapshot.mapStates[patch.mapSyncId]?.camera || null);
  }
  return cloneValue(deviceSnapshot.mapsView || null);
}

function observablePatchValue(patch) {
  if (patch.type === "setActiveMap") return patch.activeMapSyncId;
  if (patch.type === "setSelectedNode") return patch.selectedNodeSyncId;
  if (patch.type === "setMapCamera") return cloneValue(patch.camera);
  return cloneValue(patch.view);
}

export async function runPerf007BCommit(engine, store, fixture, options = {}) {
  const useFullSnapshot = options.useFullSnapshot === true;
  const stages = {};
  const checkpointBefore = JSON.stringify(store.delegate?.deviceSnapshot ?? store.deviceSnapshot);
  const totalStartedAt = performance.now();
  let expectedDevice;
  let expectedObservable;

  let startedAt = performance.now();
  if (useFullSnapshot) {
    const capturedWorkspace = cloneValue(fixture.mutatedWorkspace);
    stages.captureWorkspaceMs = performance.now() - startedAt;
    startedAt = performance.now();
    expectedDevice = captureDeviceSnapshot(capturedWorkspace, engine.deviceSnapshot);
    expectedObservable = observablePrivateState(expectedDevice, fixture.patch);
    stages.preparePrivateMs = performance.now() - startedAt;
    startedAt = performance.now();
    await engine.saveDeviceState(expectedDevice);
  } else {
    stages.captureWorkspaceMs = performance.now() - startedAt;
    startedAt = performance.now();
    expectedObservable = observablePatchValue(fixture.patch);
    stages.preparePrivateMs = performance.now() - startedAt;
    startedAt = performance.now();
    await engine.recordDevicePatches([fixture.patch]);
  }
  stages.persistPrivateMs = performance.now() - startedAt;
  stages.commitCompleteMs = performance.now() - totalStartedAt;

  const patchCall = store.calls.find(call => call.name === "commitDevicePatches");
  return {
    stages,
    privateLogicalBytes: useFullSnapshot
      ? jsonBytes(expectedDevice)
      : patchCall?.result?.logicalBytesWritten || 0,
    privatePatchCalls: store.calls.filter(call => call.name === "commitDevicePatches").length,
    privateSnapshotCalls: store.calls.filter(call => call.name === "saveDevice").length,
    checkpointUnchanged: useFullSnapshot
      ? false
      : JSON.stringify(store.delegate?.deviceSnapshot ?? store.deviceSnapshot) === checkpointBefore,
    observableMatchesExpected:
      JSON.stringify(observablePrivateState(engine.deviceSnapshot, fixture.patch)) ===
      JSON.stringify(expectedObservable)
  };
}
