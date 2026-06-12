import { createFastSharedChange } from "../runtime/transaction-persistence.js";
import { cloneValue } from "../sync/workspace-model.js";
import {
  createMemoryEngineForPerf007A,
  createPerf007AFixture
} from "./perf-007a-core.js";

export const PERF_007C_SCENARIOS = ["edit-text", "move-node", "move-map"];

function transactionPayloadForFixture(fixture) {
  const map = fixture.mutatedWorkspace.maps[0];
  const initialMap = fixture.initialWorkspace.maps[0];

  if (fixture.scenario === "move-map") {
    return {
      payload: {
        mapId: map.id,
        from: cloneValue(initialMap.constellationPosition || { x: 0, y: 0 }),
        to: cloneValue(map.constellationPosition)
      },
      identity: { mapSyncId: map.syncId }
    };
  }

  const nodeSyncId = fixture.change.payload.nodeSyncId;
  const node = map.nodes.find(candidate => candidate.syncId === nodeSyncId);
  const initialNode = initialMap.nodes.find(candidate => candidate.syncId === nodeSyncId);
  const payload = fixture.scenario === "edit-text"
    ? {
        mapId: map.id,
        nodeId: node.id,
        previousLabel: initialNode.label,
        previousNote: initialNode.note || "",
        label: node.label,
        note: node.note || ""
      }
    : {
        mapId: map.id,
        nodeId: node.id,
        from: { x: initialNode.x, y: initialNode.y },
        to: { x: node.x, y: node.y }
      };

  return {
    payload,
    identity: { mapSyncId: map.syncId, nodeSyncId: node.syncId }
  };
}

export function createPerf007CFixture(options) {
  const fixture = createPerf007AFixture(options);
  const transaction = transactionPayloadForFixture(fixture);
  const fastSharedChange = createFastSharedChange(
    fixture.transactionType,
    transaction.payload,
    transaction.identity
  );
  if (!fastSharedChange) {
    throw new Error(`PERF-007C could not prepare ${fixture.scenario}`);
  }
  return { ...fixture, ...transaction, fastSharedChange };
}

export function observableSharedState(snapshot, fixture) {
  const map = snapshot.maps.find(candidate => candidate.syncId === fixture.identity.mapSyncId);
  if (fixture.scenario === "move-map") {
    return { position: cloneValue(map?.constellationPosition || null) };
  }

  const node = map?.nodes?.find(candidate => candidate.syncId === fixture.identity.nodeSyncId);
  if (fixture.scenario === "edit-text") {
    return { label: node?.label, note: node?.note || "" };
  }
  return { position: node ? { x: node.x, y: node.y } : null };
}

export function observableRuntimeState(fixture) {
  const map = fixture.mutatedWorkspace.maps[0];
  if (fixture.scenario === "move-map") {
    return { position: cloneValue(map.constellationPosition) };
  }

  const node = map.nodes.find(candidate => candidate.syncId === fixture.identity.nodeSyncId);
  if (fixture.scenario === "edit-text") {
    return { label: node.label, note: node.note || "" };
  }
  return { position: { x: node.x, y: node.y } };
}

export async function runPerf007CCommit(engine, store, fixture, options = {}) {
  const stages = {};
  const deviceBefore = JSON.stringify(engine.deviceSnapshot);
  const totalStartedAt = performance.now();
  const forceWorkspaceCapture = options.forceWorkspaceCapture === true;

  let startedAt = performance.now();
  if (forceWorkspaceCapture) {
    cloneValue(fixture.mutatedWorkspace);
  }
  stages.captureWorkspaceMs = performance.now() - startedAt;

  startedAt = performance.now();
  const sharedChange = forceWorkspaceCapture
    ? fixture.change
    : createFastSharedChange(fixture.transactionType, fixture.payload, fixture.identity);
  stages.prepareSharedChangeMs = performance.now() - startedAt;
  if (!sharedChange) throw new Error(`Missing shared change for ${fixture.scenario}`);

  startedAt = performance.now();
  await engine.recordSharedChange(sharedChange.type, sharedChange.target, sharedChange.payload);
  stages.recordSharedChangeMs = performance.now() - startedAt;
  stages.commitCompleteMs = performance.now() - totalStartedAt;

  return {
    stages,
    workspaceCaptureCalls: forceWorkspaceCapture ? 1 : 0,
    privateSaveCalls: store.calls.filter(call => call.name === "saveDevice").length,
    sharedCommitCalls: store.calls.filter(call => call.name === "commitShared").length,
    deviceSnapshotUnchanged: JSON.stringify(engine.deviceSnapshot) === deviceBefore,
    observableMatchesRuntime:
      JSON.stringify(observableSharedState(engine.sharedSnapshot, fixture)) ===
      JSON.stringify(observableRuntimeState(fixture))
  };
}

export { createMemoryEngineForPerf007A as createMemoryEngineForPerf007C };
