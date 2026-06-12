import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { LocalSyncEngine, MemorySyncStore } from "../sync/local-sync-engine.js";
import { summarizeSamples } from "./perf-004-core.js";
import {
  PERF_008A_SCENARIOS,
  createPerf008AFixture,
  privateGrowthPatch,
  runPerf008AReplacement,
  sameStructuredValue
} from "./perf-008a-core.js";

const DEFAULT_SIZES = [1_000, 10_000, 50_000];
const GROWTH_PATTERNS = ["same-map-camera", "three-map-camera", "mixed-interleaved"];

function parseSizes(value) {
  return value
    ? value.split(",").map(item => Number(item.trim())).filter(Number.isFinite)
    : DEFAULT_SIZES;
}

function samplesForSize(size) {
  return size >= 50_000 ? 7 : 9;
}

async function createEngine(fixture, store = new MemorySyncStore()) {
  const engine = new LocalSyncEngine({ store });
  await engine.initialize({
    legacyState: fixture.initialWorkspace,
    workspaceId: fixture.initialSharedSnapshot.workspaceId,
    deviceId: fixture.initialDeviceSnapshot.deviceId
  });
  return engine;
}

async function measureReplacement(fixture) {
  return runPerf008AReplacement(await createEngine(fixture), fixture);
}

async function measureGrowth(nodeCount, pattern) {
  const fixture = createPerf008AFixture({ nodeCount, scenario: "map-camera" });
  const store = new MemorySyncStore();
  const engine = await createEngine(fixture, store);
  const startedAt = performance.now();
  for (let index = 1; index <= 1_000; index += 1) {
    await engine.recordDevicePatches([privateGrowthPatch(pattern, index)]);
  }
  const writeMs = performance.now() - startedAt;
  const restartStartedAt = performance.now();
  const restarted = new LocalSyncEngine({ store });
  await restarted.initialize();
  return {
    pattern,
    interactions: 1_000,
    patches: engine.devicePatches.length,
    patchBytes: engine.privatePatchLogBytes,
    revision: engine.privateRevision,
    writeMs,
    restartMs: performance.now() - restartStartedAt,
    exact: sameStructuredValue(restarted.deviceSnapshot, engine.deviceSnapshot)
  };
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

async function loadPerf007BBaseline() {
  try {
    const report = JSON.parse(await readFile("performance/results/perf-007b-node.json", "utf8"));
    return report.growth;
  } catch {
    return null;
  }
}

async function run() {
  const { values } = parseArgs({
    options: {
      sizes: { type: "string" },
      scenarios: { type: "string" },
      output: { type: "string", default: "performance/results/perf-008a-node.json" }
    }
  });
  const sizes = parseSizes(values.sizes);
  const scenarios = values.scenarios
    ? values.scenarios.split(",").map(item => item.trim()).filter(Boolean)
    : PERF_008A_SCENARIOS;
  const results = [];

  for (const size of sizes) {
    for (const scenario of scenarios) {
      const samples = [];
      for (let index = 0; index < samplesForSize(size); index += 1) {
        samples.push(await measureReplacement(createPerf008AFixture({ nodeCount: size, scenario })));
      }
      if (samples.some(sample => sample.patchCount !== 1 || sample.revision !== 2 || !sample.exact)) {
        throw new Error(`Coalesced replacement invariant failed for ${size} ${scenario}`);
      }
      const result = {
        size,
        scenario,
        commitCompleteMs: summarizeSamples(samples.map(sample => sample.commitCompleteMs)),
        logicalBytesWritten: summarizeSamples(samples.map(sample => sample.logicalBytesWritten)),
        patchBytes: summarizeSamples(samples.map(sample => sample.patchBytes))
      };
      results.push(result);
      console.log(
        `${String(size).padStart(6)}  ${scenario.padEnd(18)} ` +
        `${result.commitCompleteMs.p50.toFixed(3)} ms p50 / ` +
        `${result.commitCompleteMs.p95.toFixed(3)} ms p95`
      );
    }
  }

  const growth = [];
  for (const pattern of GROWTH_PATTERNS) {
    const result = await measureGrowth(Math.max(...sizes), pattern);
    if (!result.exact) throw new Error(`Growth replay failed for ${pattern}`);
    growth.push(result);
  }

  const report = {
    schemaVersion: 1,
    experiment: "PERF-008A-node",
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
    configuration: { sizes, scenarios, interactions: 1_000 },
    perf007bGrowthBaseline: await loadPerf007BBaseline(),
    growth,
    results
  };
  const outputPath = resolve(values.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`PERF-008A Node written to ${outputPath}`);
}

await run();
