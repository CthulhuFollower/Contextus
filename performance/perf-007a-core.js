import { getTransactionPersistenceContract } from "../runtime/transaction-persistence.js";
import { captureDeviceSnapshot, cloneValue } from "../sync/workspace-model.js";
import {
  createMemoryEngineForPerf004,
  createPerf004Fixture
} from "./perf-004-core.js";

export const PERF_007A_SCENARIOS = ["edit-text", "move-node", "move-map"];

const TRANSACTION_TYPE_BY_SCENARIO = Object.freeze({
  "edit-text": "editNode",
  "move-node": "moveNode",
  "move-map": "moveConstellationMap"
});

function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function createPerf007AFixture(options) {
  const { scenario } = options;
  if (!PERF_007A_SCENARIOS.includes(scenario)) {
    throw new RangeError(`Unknown PERF-007A scenario: ${scenario}`);
  }

  const fixture = createPerf004Fixture({
    ...options,
    scenario: scenario === "move-map" ? "move-node" : scenario
  });

  if (scenario === "move-map") {
    fixture.mutatedWorkspace = cloneValue(fixture.initialWorkspace);
    const map = fixture.mutatedWorkspace.maps[0];
    const from = cloneValue(map.constellationPosition || { x: 0, y: 0 });
    const to = { x: from.x + 37, y: from.y - 19 };
    map.constellationPosition = to;
    fixture.change = {
      type: "map.move",
      target: { kind: "map", syncId: map.syncId },
      payload: { mapSyncId: map.syncId, position: cloneValue(to) }
    };
  }

  fixture.scenario = scenario;
  fixture.transactionType = TRANSACTION_TYPE_BY_SCENARIO[scenario];
  return fixture;
}

export async function createMemoryEngineForPerf007A(fixture) {
  return createMemoryEngineForPerf004(fixture);
}

export async function runPerf007ACommit(engine, store, fixture, options = {}) {
  const persistence = getTransactionPersistenceContract(fixture.transactionType);
  const persistPrivate = options.forcePrivatePersistence || persistence.private;
  const deviceBefore = JSON.stringify(engine.deviceSnapshot);
  const stages = {};
  const totalStartedAt = performance.now();

  let startedAt = performance.now();
  const capturedWorkspace = cloneValue(fixture.mutatedWorkspace);
  stages.captureWorkspaceMs = performance.now() - startedAt;

  let deviceState = null;
  startedAt = performance.now();
  if (persistPrivate) {
    deviceState = captureDeviceSnapshot(capturedWorkspace, engine.deviceSnapshot);
  }
  stages.captureDeviceMs = performance.now() - startedAt;

  startedAt = performance.now();
  if (persistence.shared) {
    await engine.recordSharedChange(
      fixture.change.type,
      fixture.change.target,
      fixture.change.payload
    );
  }
  stages.recordSharedChangeMs = performance.now() - startedAt;

  startedAt = performance.now();
  if (deviceState) {
    await engine.saveDeviceState(deviceState);
  }
  stages.saveDeviceStateMs = performance.now() - startedAt;
  stages.commitCompleteMs = performance.now() - totalStartedAt;

  return {
    persistence: { ...persistence, privatePersisted: Boolean(deviceState) },
    stages,
    privateLogicalBytes: deviceState ? jsonBytes(deviceState) : 0,
    privateSaveCalls: store.calls.filter(call => call.name === "saveDevice").length,
    sharedCommitCalls: store.calls.filter(call => call.name === "commitShared").length,
    deviceSnapshotUnchanged: JSON.stringify(engine.deviceSnapshot) === deviceBefore
  };
}
