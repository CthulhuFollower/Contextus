import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

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

async function run() {
  const { values } = parseArgs({
    options: {
      sizes: { type: "string" },
      scenarios: { type: "string" },
      "note-size": { type: "string", default: "100" },
      output: { type: "string", default: "performance/results/perf-004-node.json" }
    }
  });

  const sizes = parseSizes(values.sizes);
  const scenarios = values.scenarios
    ? values.scenarios.split(",").map(item => item.trim()).filter(Boolean)
    : PERF_004_SCENARIOS;
  const noteSize = Number(values["note-size"]);
  const outputPath = resolve(values.output);
  const results = [];

  for (const size of sizes) {
    for (const scenario of scenarios) {
      const samples = [];
      const sampleCount = samplesForSize(size);
      let deletedNodeCount = 0;

      for (let index = 0; index < sampleCount; index += 1) {
        const fixture = createPerf004Fixture({ nodeCount: size, scenario, noteSize });
        deletedNodeCount = fixture.deletedNodeCount;
        const { engine, store } = await createMemoryEngineForPerf004(fixture);
        samples.push(await runPerf004Commit(engine, store, fixture));
      }

      const storeDuration = (sample, name) =>
        sample.storeCalls.find(call => call.name === name)?.durationMs || 0;
      const result = {
        size,
        scenario,
        deletedNodeCount,
        metrics: {
          captureWorkspaceMs: summarizeMetric(samples, sample => sample.stages.captureWorkspaceMs),
          captureDeviceMs: summarizeMetric(samples, sample => sample.stages.captureDeviceMs),
          recordSharedChangeMs: summarizeMetric(samples, sample => sample.stages.recordSharedChangeMs),
          sharedStoreMs: summarizeMetric(samples, sample => storeDuration(sample, "commitShared")),
          saveDeviceStateMs: summarizeMetric(samples, sample => sample.stages.saveDeviceStateMs),
          deviceStoreMs: summarizeMetric(samples, sample => storeDuration(sample, "saveDevice")),
          commitCompleteMs: summarizeMetric(samples, sample => sample.stages.commitCompleteMs),
          serializationMs: summarizeMetric(samples, sample => sample.serializationMs.total)
        },
        bytes: samples[0].bytes
      };
      results.push(result);
      console.log(
        `${String(size).padStart(6)}  ${scenario.padEnd(14)} ` +
        `${result.metrics.commitCompleteMs.p50.toFixed(2)} ms commit p50 / ` +
        `${result.bytes.total.toLocaleString()} bytes`
      );
    }
  }

  const report = {
    schemaVersion: 1,
    experiment: "PERF-004-node",
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
  console.log(`PERF-004 Node written to ${outputPath}`);
}

await run();
