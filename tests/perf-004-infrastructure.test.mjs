import assert from "node:assert/strict";
import test from "node:test";

import {
  PERF_004_SCENARIOS,
  createMemoryEngineForPerf004,
  createPerf004Fixture,
  runPerf004Commit
} from "../performance/perf-004-core.js";

test("PERF-004 fixtures create valid isolated shared changes", () => {
  for (const scenario of PERF_004_SCENARIOS) {
    const fixture = createPerf004Fixture({ nodeCount: 100, scenario });
    assert.equal(fixture.initialWorkspace.maps[0].nodes.length, 100);
    assert.ok(fixture.change.type);
    assert.ok(fixture.change.target.mapSyncId);
    assert.notEqual(fixture.initialWorkspace, fixture.mutatedWorkspace);
  }
});

test("PERF-004 commit instrumentation records all current pipeline stages", async () => {
  const fixture = createPerf004Fixture({ nodeCount: 100, scenario: "edit-text" });
  const { engine, store } = await createMemoryEngineForPerf004(fixture);
  const result = await runPerf004Commit(engine, store, fixture);

  assert.ok(result.stages.commitCompleteMs >= 0);
  assert.ok(result.storeCalls.some(call => call.name === "commitShared"));
  assert.ok(result.storeCalls.some(call => call.name === "saveDevice"));
  assert.ok(result.bytes.sharedSnapshot > 0);
  assert.ok(result.bytes.deviceSnapshot > 0);
});
