import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { summarizeSamples } from "./perf-004-core.js";
import {
  PERF_007C_SCENARIOS,
  createMemoryEngineForPerf007C,
  createPerf007CFixture,
  runPerf007CCommit
} from "./perf-007c-core.js";

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
    prepareSharedChangeMs: summarizeMetric(samples, sample => sample.stages.prepareSharedChangeMs),
    recordSharedChangeMs: summarizeMetric(samples, sample => sample.stages.recordSharedChangeMs),
    commitCompleteMs: summarizeMetric(samples, sample => sample.stages.commitCompleteMs),
    workspaceCaptureCalls: summarizeMetric(samples, sample => sample.workspaceCaptureCalls)
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

async function measureRoute(fixture, forceWorkspaceCapture) {
  const { engine, store } = await createMemoryEngineForPerf007C(fixture);
  return runPerf007CCommit(engine, store, fixture, { forceWorkspaceCapture });
}

async function run() {
  const { values } = parseArgs({
    options: {
      sizes: { type: "string" },
      scenarios: { type: "string" },
      "note-size": { type: "string", default: "100" },
      output: { type: "string", default: "performance/results/perf-007c-node.json" }
    }
  });
  const sizes = parseSizes(values.sizes);
  const scenarios = values.scenarios
    ? values.scenarios.split(",").map(item => item.trim()).filter(Boolean)
    : PERF_007C_SCENARIOS;
  const noteSize = Number(values["note-size"]);
  const outputPath = resolve(values.output);
  const results = [];

  for (const size of sizes) {
    for (const scenario of scenarios) {
      const captured = [];
      const fast = [];
      for (let index = 0; index < samplesForSize(size); index += 1) {
        captured.push(await measureRoute(
          createPerf007CFixture({ nodeCount: size, scenario, noteSize }),
          true
        ));
        fast.push(await measureRoute(
          createPerf007CFixture({ nodeCount: size, scenario, noteSize }),
          false
        ));
      }

      if (fast.some(sample =>
        sample.workspaceCaptureCalls !== 0 ||
        !sample.deviceSnapshotUnchanged ||
        !sample.observableMatchesRuntime
      )) {
        throw new Error(`Fast route invariant failed for ${size} ${scenario}`);
      }

      const result = {
        size,
        scenario,
        captured: summarizeRoute(captured),
        fast: summarizeRoute(fast)
      };
      results.push(result);
      console.log(
        `${String(size).padStart(6)}  ${scenario.padEnd(10)} ` +
        `${result.captured.commitCompleteMs.p50.toFixed(2)} -> ` +
        `${result.fast.commitCompleteMs.p50.toFixed(2)} ms commit`
      );
    }
  }

  const report = {
    schemaVersion: 1,
    experiment: "PERF-007C-node",
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
    results
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`PERF-007C Node written to ${outputPath}`);
}

await run();
