import assert from "node:assert/strict";
import test from "node:test";

import { LocalSyncEngine } from "../sync/local-sync-engine.js";
import {
  PERF_007C_SCENARIOS,
  createMemoryEngineForPerf007C,
  createPerf007CFixture,
  observableRuntimeState,
  observableSharedState,
  runPerf007CCommit
} from "../performance/perf-007c-core.js";

test("PERF-007C fast changes are equivalent to the existing translated changes", () => {
  for (const scenario of PERF_007C_SCENARIOS) {
    const fixture = createPerf007CFixture({ nodeCount: 100, scenario });
    assert.deepEqual(fixture.fastSharedChange, fixture.change);
  }
});

test("PERF-007C normal route performs zero workspace captures", async () => {
  for (const scenario of PERF_007C_SCENARIOS) {
    const fixture = createPerf007CFixture({ nodeCount: 100, scenario });
    const { engine, store } = await createMemoryEngineForPerf007C(fixture);
    const result = await runPerf007CCommit(engine, store, fixture);

    assert.equal(result.workspaceCaptureCalls, 0);
    assert.equal(result.sharedCommitCalls, 1);
    assert.equal(result.privateSaveCalls, 0);
    assert.equal(result.deviceSnapshotUnchanged, true);
    assert.equal(result.observableMatchesRuntime, true);
  }
});

test("PERF-007C restart preserves observable runtime state", async () => {
  for (const scenario of PERF_007C_SCENARIOS) {
    const fixture = createPerf007CFixture({ nodeCount: 100, scenario });
    const { engine, store } = await createMemoryEngineForPerf007C(fixture);
    await runPerf007CCommit(engine, store, fixture);

    const restarted = new LocalSyncEngine({ store });
    await restarted.initialize();
    assert.deepEqual(observableSharedState(restarted.sharedSnapshot, fixture), observableRuntimeState(fixture));
  }
});
