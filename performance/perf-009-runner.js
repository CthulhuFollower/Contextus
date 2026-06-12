import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { rebuildChildrenByParentId, rebuildNodesById } from "../runtime/node-index.js";
import { createStartupProfiler, measureStartupSync } from "../runtime/startup-profiler.js";
import { LocalSyncEngine } from "../sync/local-sync-engine.js";
import { cloneValue, materializeWorkspace } from "../sync/workspace-model.js";
import {
  PERF_009_SCENARIOS,
  PERF_009_TOPOLOGIES,
  createPerf009Fixture,
  createPerf009MemoryStore,
  summarizeStartupProfiles
} from "./perf-009-core.js";

const DEFAULT_SIZES = [1_000, 10_000, 50_000];

function parseList(value, fallback, convert = item => item) {
  return value
    ? value.split(",").map(item => convert(item.trim())).filter(item => item !== "")
    : fallback;
}

function sampleCount(size) {
  return size >= 50_000 ? 3 : 5;
}

function getGitState() {
  try {
    return {
      commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      dirty: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0
    };
  } catch {
    return { commit: null, dirty: null };
  }
}

async function measureStartup(store, fixture) {
  global.gc?.();
  const profiler = createStartupProfiler({
    context: {
      totalNodes: fixture.totalNodes,
      topology: fixture.topology,
      scenario: fixture.scenario
    }
  });
  const engine = new LocalSyncEngine({ store, profiler });
  const initialized = await engine.initialize();
  const materialized = materializeWorkspace(initialized.sharedSnapshot, initialized.deviceSnapshot, { profiler });
  const activeMap = materialized.state.maps.find(map => map.id === materialized.state.activeMapId);
  const activeNodes = measureStartupSync(
    profiler,
    "nodeHydration.copyActiveNodes",
    () => cloneValue(activeMap.nodes)
  );
  measureStartupSync(profiler, "nodeHydration.nodesById", () => rebuildNodesById(activeNodes));
  measureStartupSync(
    profiler,
    "nodeHydration.childrenByParentId",
    () => rebuildChildrenByParentId(activeNodes)
  );
  profiler.mark("nodeHydration.ready", { activeNodeCount: activeNodes.length });
  return profiler.complete({
    mapCount: materialized.state.maps.length,
    operationCount: engine.operations.length,
    privatePatchCount: engine.devicePatches.length
  });
}

async function run() {
  const { values } = parseArgs({
    options: {
      sizes: { type: "string" },
      topologies: { type: "string" },
      scenarios: { type: "string" },
      output: { type: "string", default: "performance/results/perf-009-node.json" }
    }
  });
  const sizes = parseList(values.sizes, DEFAULT_SIZES, Number).filter(Number.isFinite);
  const topologies = parseList(values.topologies, PERF_009_TOPOLOGIES);
  const scenarios = parseList(values.scenarios, PERF_009_SCENARIOS);
  const results = [];

  for (const totalNodes of sizes) {
    for (const topology of topologies) {
      for (const scenario of scenarios) {
        const fixture = createPerf009Fixture({ totalNodes, topology, scenario });
        const { store } = await createPerf009MemoryStore(fixture);
        const samples = [];
        for (let index = 0; index < sampleCount(totalNodes); index += 1) {
          samples.push(await measureStartup(store, fixture));
        }
        const summary = summarizeStartupProfiles(samples);
        results.push({ totalNodes, topology, scenario, samples, summary });
        console.log(
          `${String(totalNodes).padStart(6)} ${topology.padEnd(11)} ${scenario.padEnd(18)} ` +
          `${summary.totalMs.p50.toFixed(1)} ms p50 / ${summary.totalMs.p95.toFixed(1)} ms p95`
        );
      }
    }
  }

  const report = {
    schemaVersion: 1,
    experiment: "PERF-009-node",
    createdAt: new Date().toISOString(),
    environment: {
      node: process.version,
      v8: process.versions.v8,
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model || null
    },
    git: getGitState(),
    configuration: { sizes, topologies, scenarios },
    results
  };
  const outputPath = resolve(values.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`PERF-009 Node written to ${outputPath}`);
}

await run();
