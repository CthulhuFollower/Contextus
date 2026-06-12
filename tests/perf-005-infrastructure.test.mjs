import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryEngineForPerf004,
  createPerf004Fixture,
  runPerf004Commit
} from "../performance/perf-004-core.js";

async function logicalSharedBytes(nodeCount) {
  const fixture = createPerf004Fixture({ nodeCount, scenario: "edit-text" });
  const { engine, store } = await createMemoryEngineForPerf004(fixture);
  const result = await runPerf004Commit(engine, store, fixture);
  return result.storeCalls.find(call => call.name === "commitShared").result.logicalBytesWritten;
}

test("PERF-005 incremental shared write bytes do not grow with universe size", async () => {
  const small = await logicalSharedBytes(1_000);
  const large = await logicalSharedBytes(50_000);

  assert.ok(small > 0);
  assert.ok(large > 0);
  assert.ok(Math.abs(large - small) < 256);
});
