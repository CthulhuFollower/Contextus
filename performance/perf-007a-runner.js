import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { summarizeSamples } from "./perf-004-core.js";
import {
  PERF_007A_SCENARIOS,
  createMemoryEngineForPerf007A,
  createPerf007AFixture,
  runPerf007ACommit
} from "./perf-007a-core.js";

const DEFAULT_SIZES = [1_000, 10_000, 50_000];

function parseSizes(value) {
  if (!value) return DEFAULT_SIZES;
  return value.split(",").map(item => Number(item.trim())).filter(Number.isFinite);
}

function samplesForSize(size) {
  if (size >= 50_000) return 3;
  if (size >= 10_000) return 5;
  return 7;
}

function summarizeMetric(samples, read) {
  return summarizeSamples(samples.map(read));
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

async function measureRoute(fixture, forcePrivatePersistence) {
  const { engine, store } = await createMemoryEngineForPerf007A(fixture);
  return runPerf007ACommit(engine, store, fixture, { forcePrivatePersistence });
}

function summarizeRoute(samples) {
  return {
    captureWorkspaceMs: summarizeMetric(samples, sample => sample.stages.captureWorkspaceMs),
    captureDeviceMs: summarizeMetric(samples, sample => sample.stages.captureDeviceMs),
    recordSharedChangeMs: summarizeMetric(samples, sample => sample.stages.recordSharedChangeMs),
    saveDeviceStateMs: summarizeMetric(samples, sample => sample.stages.saveDeviceStateMs),
    commitCompleteMs: summarizeMetric(samples, sample => sample.stages.commitCompleteMs),
    privateLogicalBytes: summarizeMetric(samples, sample => sample.privateLogicalBytes),
    privateSaveCalls: summarizeMetric(samples, sample => sample.privateSaveCalls)
  };
}

async function run() {
  const { values } = parseArgs({
    options: {
      sizes: { type: "string" },
      scenarios: { type: "string" },
      "note-size": { type: "string", default: "100" },
      output: { type: "string", default: "performance/results/perf-007a-node.json" }
    }
  });
  const sizes = parseSizes(values.sizes);
  const scenarios = values.scenarios
    ? values.scenarios.split(",").map(item => item.trim()).filter(Boolean)
    : PERF_007A_SCENARIOS;
  const noteSize = Number(values["note-size"]);
  const outputPath = resolve(values.output);
  const results = [];

  for (const size of sizes) {
    for (const scenario of scenarios) {
      const fullPrivate = [];
      const contractPrivate = [];

      for (let index = 0; index < samplesForSize(size); index += 1) {
        fullPrivate.push(await measureRoute(
          createPerf007AFixture({ nodeCount: size, scenario, noteSize }),
          true
        ));
        contractPrivate.push(await measureRoute(
          createPerf007AFixture({ nodeCount: size, scenario, noteSize }),
          false
        ));
      }

      if (contractPrivate.some(sample => !sample.deviceSnapshotUnchanged || sample.privateSaveCalls !== 0)) {
        throw new Error(`Private state changed unexpectedly for ${size} ${scenario}`);
      }

      const result = {
        size,
        scenario,
        fullPrivate: summarizeRoute(fullPrivate),
        contractPrivate: summarizeRoute(contractPrivate)
      };
      results.push(result);
      console.log(
        `${String(size).padStart(6)}  ${scenario.padEnd(10)} ` +
        `${result.fullPrivate.commitCompleteMs.p50.toFixed(2)} -> ` +
        `${result.contractPrivate.commitCompleteMs.p50.toFixed(2)} ms commit / ` +
        `${result.fullPrivate.privateLogicalBytes.p50} -> 0 private bytes`
      );
    }
  }

  const report = {
    schemaVersion: 1,
    experiment: "PERF-007A-node",
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
  console.log(`PERF-007A Node written to ${outputPath}`);
}

await run();
