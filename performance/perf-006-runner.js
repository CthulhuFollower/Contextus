import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  applyOperation,
  applyOperationMutable
} from "../sync/merge-engine.js";
import { cloneValue } from "../sync/workspace-model.js";
import {
  PERF_004_SCENARIOS,
  createMemoryEngineForPerf004,
  createPerf004Fixture,
  runPerf004Commit,
  summarizeSamples
} from "./perf-004-core.js";

const DEFAULT_SIZES = [1_000, 10_000, 50_000];

function parseSizes(value) {
  if (!value) return DEFAULT_SIZES;
  return value.split(",").map(item => Number(item.trim())).filter(Number.isFinite);
}

function samplesForSize(size) {
  if (size >= 50_000) return 2;
  if (size >= 10_000) return 3;
  return 5;
}

function operationForFixture(fixture) {
  return {
    operationId: `operation_perf006_${fixture.nodeCount}_${fixture.scenario}`,
    workspaceId: fixture.initialSharedSnapshot.workspaceId,
    deviceId: fixture.initialDeviceSnapshot.deviceId,
    sequence: 1,
    context: {},
    clock: {
      wallTime: 10_000,
      counter: 0,
      deviceId: fixture.initialDeviceSnapshot.deviceId
    },
    type: fixture.change.type,
    target: cloneValue(fixture.change.target),
    payload: cloneValue(fixture.change.payload)
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

function summarizeMetric(samples, read) {
  return summarizeSamples(samples.map(read));
}

function measureApply(fixture, operation) {
  const pureInput = fixture.initialSharedSnapshot;
  let startedAt = performance.now();
  const pureResult = applyOperation(pureInput, operation);
  const pureMs = performance.now() - startedAt;

  const mutableInput = cloneValue(fixture.initialSharedSnapshot);
  startedAt = performance.now();
  const mutableResult = applyOperationMutable(mutableInput, operation);
  const mutableMs = performance.now() - startedAt;

  return {
    pureMs,
    mutableMs,
    equivalent: JSON.stringify(pureResult) === JSON.stringify(mutableResult)
  };
}

function measureApplicationMemory(fixture, operation) {
  if (!globalThis.gc) return null;

  globalThis.gc();
  const pureBeforeBytes = process.memoryUsage().heapUsed;
  let pureResult = applyOperation(fixture.initialSharedSnapshot, operation);
  const pureAfterBytes = process.memoryUsage().heapUsed;
  pureResult = null;
  globalThis.gc();

  const mutableInput = cloneValue(fixture.initialSharedSnapshot);
  globalThis.gc();
  const mutableBeforeBytes = process.memoryUsage().heapUsed;
  applyOperationMutable(mutableInput, operation);
  const mutableAfterBytes = process.memoryUsage().heapUsed;

  return {
    pureTransientBytes: pureAfterBytes - pureBeforeBytes,
    mutableTransientBytes: mutableAfterBytes - mutableBeforeBytes
  };
}

async function run() {
  const { values } = parseArgs({
    options: {
      sizes: { type: "string" },
      scenarios: { type: "string" },
      "note-size": { type: "string", default: "100" },
      output: { type: "string", default: "performance/results/perf-006-node.json" }
    }
  });
  const sizes = parseSizes(values.sizes);
  const scenarios = values.scenarios
    ? values.scenarios.split(",").map(item => item.trim()).filter(Boolean)
    : PERF_004_SCENARIOS;
  const noteSize = Number(values["note-size"]);
  const outputPath = resolve(values.output);
  const results = [];
  const memory = [];
  const largestSize = Math.max(...sizes);

  for (const size of sizes) {
    for (const scenario of scenarios) {
      const commits = [];
      const applications = [];
      let deletedNodeCount = 0;

      for (let index = 0; index < samplesForSize(size); index += 1) {
        const fixture = createPerf004Fixture({ nodeCount: size, scenario, noteSize });
        deletedNodeCount = fixture.deletedNodeCount;
        applications.push(measureApply(fixture, operationForFixture(fixture)));
        const { engine, store } = await createMemoryEngineForPerf004(fixture);
        commits.push(await runPerf004Commit(engine, store, fixture));
      }

      if (applications.some(sample => !sample.equivalent)) {
        throw new Error(`Pure and mutable application diverged for ${size} ${scenario}`);
      }

      const result = {
        size,
        scenario,
        deletedNodeCount,
        application: {
          pureMs: summarizeMetric(applications, sample => sample.pureMs),
          mutableMs: summarizeMetric(applications, sample => sample.mutableMs)
        },
        commit: {
          recordSharedChangeMs: summarizeMetric(commits, sample => sample.stages.recordSharedChangeMs),
          commitCompleteMs: summarizeMetric(commits, sample => sample.stages.commitCompleteMs)
        }
      };
      results.push(result);
      if (size === largestSize) {
        const memoryFixture = createPerf004Fixture({ nodeCount: size, scenario, noteSize });
        const measurement = measureApplicationMemory(
          memoryFixture,
          operationForFixture(memoryFixture)
        );
        if (measurement) memory.push({ size, scenario, ...measurement });
      }
      console.log(
        `${String(size).padStart(6)}  ${scenario.padEnd(14)} ` +
        `${result.application.pureMs.p50.toFixed(2)} -> ${result.application.mutableMs.p50.toFixed(2)} ms apply / ` +
        `${result.commit.commitCompleteMs.p50.toFixed(2)} ms commit`
      );
    }
  }

  const report = {
    schemaVersion: 1,
    experiment: "PERF-006-node",
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
    memory,
    results
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`PERF-006 Node written to ${outputPath}`);
}

await run();
