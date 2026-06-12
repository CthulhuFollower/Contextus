import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { summarizeSamples } from "./perf-004-core.js";
import { LocalSyncEngine } from "../sync/local-sync-engine.js";
import {
  PERF_007B_SCENARIOS,
  createMemoryEngineForPerf007B,
  createPerf007BFixture,
  runPerf007BCommit
} from "./perf-007b-core.js";

const DEFAULT_SIZES = [1_000, 10_000, 50_000];

function parseSizes(value) {
  if (!value) return DEFAULT_SIZES;
  return value.split(",").map(item => Number(item.trim())).filter(Number.isFinite);
}

function samplesForSize(size) {
  return size >= 50_000 ? 5 : 7;
}

function summarizeMetric(samples, read) {
  return summarizeSamples(samples.map(read));
}

function summarizeRoute(samples) {
  return {
    captureWorkspaceMs: summarizeMetric(samples, sample => sample.stages.captureWorkspaceMs),
    preparePrivateMs: summarizeMetric(samples, sample => sample.stages.preparePrivateMs),
    persistPrivateMs: summarizeMetric(samples, sample => sample.stages.persistPrivateMs),
    commitCompleteMs: summarizeMetric(samples, sample => sample.stages.commitCompleteMs),
    privateLogicalBytes: summarizeMetric(samples, sample => sample.privateLogicalBytes)
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

async function measureRoute(fixture, useFullSnapshot) {
  const { engine, store } = await createMemoryEngineForPerf007B(fixture);
  return runPerf007BCommit(engine, store, fixture, { useFullSnapshot });
}

async function measureGrowth(nodeCount, noteSize) {
  const fixture = createPerf007BFixture({ nodeCount, scenario: "map-camera", noteSize });
  const { engine, store } = await createMemoryEngineForPerf007B(fixture);
  const mapSyncId = fixture.patch.mapSyncId;
  const startedAt = performance.now();
  for (let index = 1; index <= 1_000; index += 1) {
    await engine.recordDevicePatches([
      {
        type: "setMapCamera",
        mapSyncId,
        camera: { x: index, y: -index, zoom: 1 + index / 1_000 }
      }
    ]);
  }
  const writeMs = performance.now() - startedAt;
  const restartStartedAt = performance.now();
  const restarted = new LocalSyncEngine({ store });
  await restarted.initialize();
  return {
    interactions: 1_000,
    patches: engine.devicePatches.length,
    patchBytes: engine.privatePatchLogBytes,
    writeMs,
    restartMs: performance.now() - restartStartedAt
  };
}

async function run() {
  const { values } = parseArgs({
    options: {
      sizes: { type: "string" },
      scenarios: { type: "string" },
      "note-size": { type: "string", default: "100" },
      output: { type: "string", default: "performance/results/perf-007b-node.json" }
    }
  });
  const sizes = parseSizes(values.sizes);
  const scenarios = values.scenarios
    ? values.scenarios.split(",").map(item => item.trim()).filter(Boolean)
    : PERF_007B_SCENARIOS;
  const noteSize = Number(values["note-size"]);
  const outputPath = resolve(values.output);
  const results = [];

  for (const size of sizes) {
    for (const scenario of scenarios) {
      const full = [];
      const incremental = [];
      for (let index = 0; index < samplesForSize(size); index += 1) {
        full.push(await measureRoute(
          createPerf007BFixture({ nodeCount: size, scenario, noteSize }),
          true
        ));
        incremental.push(await measureRoute(
          createPerf007BFixture({ nodeCount: size, scenario, noteSize }),
          false
        ));
      }
      if (incremental.some(sample =>
        sample.privatePatchCalls !== 1 ||
        sample.privateSnapshotCalls !== 0 ||
        !sample.checkpointUnchanged ||
        !sample.observableMatchesExpected
      )) {
        throw new Error(`Incremental private invariant failed for ${size} ${scenario}`);
      }
      const result = {
        size,
        scenario,
        full: summarizeRoute(full),
        incremental: summarizeRoute(incremental)
      };
      results.push(result);
      console.log(
        `${String(size).padStart(6)}  ${scenario.padEnd(18)} ` +
        `${result.full.commitCompleteMs.p50.toFixed(2)} -> ` +
        `${result.incremental.commitCompleteMs.p50.toFixed(2)} ms / ` +
        `${result.full.privateLogicalBytes.p50} -> ${result.incremental.privateLogicalBytes.p50} bytes`
      );
    }
  }

  const report = {
    schemaVersion: 1,
    experiment: "PERF-007B-node",
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
    configuration: { sizes, scenarios, noteSize },
    growth: await measureGrowth(Math.max(...sizes), noteSize),
    results
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`PERF-007B Node written to ${outputPath}`);
}

await run();
