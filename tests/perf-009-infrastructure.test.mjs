import assert from "node:assert/strict";
import test from "node:test";

import { rebuildChildrenByParentId, rebuildNodesById } from "../runtime/node-index.js";
import { createStartupProfiler, measureStartupSync } from "../runtime/startup-profiler.js";
import { LocalSyncEngine } from "../sync/local-sync-engine.js";
import { materializeWorkspace } from "../sync/workspace-model.js";
import {
  createPerf009Fixture,
  createPerf009MemoryStore
} from "../performance/perf-009-core.js";

test("startup profiler records spans, marks, context, and completion", () => {
  let clock = 0;
  const profiler = createStartupProfiler({ clock: () => clock, startedAt: 0, runId: "test" });
  const value = measureStartupSync(profiler, "phase", () => {
    clock = 12;
    return 7;
  });
  profiler.mark("ready");
  const report = profiler.complete({ maps: 1 });

  assert.equal(value, 7);
  assert.equal(report.runId, "test");
  assert.equal(report.spans[0].durationMs, 12);
  assert.equal(report.marks[0].name, "ready");
  assert.equal(report.context.maps, 1);
});

test("disabled startup profiler executes tasks without recording data", async () => {
  const profiler = createStartupProfiler({ enabled: false });
  assert.equal(measureStartupSync(profiler, "sync", () => 3), 3);
  assert.deepEqual(profiler.snapshot().spans, []);
});

test("PERF-009 fixture preserves total nodes across topologies", () => {
  for (const topology of ["single-map", "many-maps"]) {
    const fixture = createPerf009Fixture({ totalNodes: 1_000, topology, scenario: "clean" });
    assert.equal(
      fixture.workspace.maps.reduce((total, map) => total + map.nodes.length, 0),
      1_000
    );
  }
});

test("instrumented engine and hydration preserve state while reporting startup phases", async () => {
  const fixture = createPerf009Fixture({
    totalNodes: 100,
    topology: "single-map",
    scenario: "structural-private"
  });
  const { store } = await createPerf009MemoryStore(fixture);
  const profiler = createStartupProfiler();
  const engine = new LocalSyncEngine({ store, profiler });
  const initialized = await engine.initialize();
  const materialized = materializeWorkspace(initialized.sharedSnapshot, initialized.deviceSnapshot, { profiler });
  const activeMap = materialized.state.maps[0];
  rebuildNodesById(activeMap.nodes);
  rebuildChildrenByParentId(activeMap.nodes);
  const names = new Set(profiler.snapshot().spans.map(span => span.name));

  assert.equal(activeMap.nodes.length, 100);
  assert.ok(names.has("engine.storeLoad"));
  assert.ok(names.has("engine.cloneShared"));
  assert.ok(names.has("engine.getStateClone"));
  assert.ok(names.has("hydration.materialize.total"));
  assert.ok(names.has("hydration.materialize.aliasNodes"));
});
