import assert from "node:assert/strict";
import test from "node:test";

import { LocalSyncEngine } from "../sync/local-sync-engine.js";
import { cloneValue } from "../sync/workspace-model.js";
import {
  PERF_007A_SCENARIOS,
  createMemoryEngineForPerf007A,
  createPerf007AFixture,
  runPerf007ACommit
} from "../performance/perf-007a-core.js";

test("PERF-007A scenarios persist shared changes without private writes", async () => {
  for (const scenario of PERF_007A_SCENARIOS) {
    const fixture = createPerf007AFixture({ nodeCount: 100, scenario });
    const { engine, store } = await createMemoryEngineForPerf007A(fixture);
    const result = await runPerf007ACommit(engine, store, fixture);

    assert.equal(result.sharedCommitCalls, 1);
    assert.equal(result.privateSaveCalls, 0);
    assert.equal(result.privateLogicalBytes, 0);
    assert.equal(result.deviceSnapshotUnchanged, true);
  }
});

test("PERF-007A comparison route reproduces the previous full private save", async () => {
  const fixture = createPerf007AFixture({ nodeCount: 100, scenario: "edit-text" });
  const { engine, store } = await createMemoryEngineForPerf007A(fixture);
  const result = await runPerf007ACommit(engine, store, fixture, {
    forcePrivatePersistence: true
  });

  assert.equal(result.sharedCommitCalls, 1);
  assert.equal(result.privateSaveCalls, 1);
  assert.ok(result.privateLogicalBytes > 0);
});

test("PERF-007A restart reconstructs shared changes and preserves private state", async () => {
  const fixture = createPerf007AFixture({ nodeCount: 100, scenario: "edit-text" });
  const { engine, store } = await createMemoryEngineForPerf007A(fixture);
  const deviceBefore = cloneValue(engine.deviceSnapshot);
  await runPerf007ACommit(engine, store, fixture);

  const restarted = new LocalSyncEngine({ store });
  await restarted.initialize();
  const changedNode = restarted.sharedSnapshot.maps[0].nodes
    .find(node => node.syncId === fixture.change.payload.nodeSyncId);

  assert.equal(changedNode.label, fixture.change.payload.changes.label);
  assert.deepEqual(restarted.deviceSnapshot, deviceBefore);
});
