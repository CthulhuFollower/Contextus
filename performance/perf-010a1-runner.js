import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { summarizeSamples } from "./perf-004-core.js";
import {
  PERF_010A1_CAMERAS,
  classifyPerf010A1Fixture,
  createPerf010A1Fixture
} from "./perf-010a1-core.js";

const DEFAULT_SIZES = [1_000, 10_000, 50_000];

function parseList(value, fallback, convert = item => item) {
  return value
    ? value.split(",").map(item => convert(item.trim())).filter(item => item !== "")
    : fallback;
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

function measureClassification(fixture) {
  const samples = [];
  let lastResult = null;
  for (let index = 0; index < 15; index += 1) {
    const startedAt = performance.now();
    lastResult = classifyPerf010A1Fixture(fixture);
    samples.push(performance.now() - startedAt);
  }
  return {
    classificationMs: summarizeSamples(samples),
    metrics: lastResult.metrics
  };
}

async function run() {
  const { values } = parseArgs({
    options: {
      sizes: { type: "string" },
      cameras: { type: "string" },
      output: { type: "string", default: "performance/results/perf-010a1-node.json" }
    }
  });
  const sizes = parseList(values.sizes, DEFAULT_SIZES, Number).filter(Number.isFinite);
  const cameras = parseList(values.cameras, PERF_010A1_CAMERAS);
  const results = [];

  for (const nodeCount of sizes) {
    for (const cameraName of cameras) {
      const result = measureClassification(createPerf010A1Fixture({ nodeCount, cameraName }));
      results.push({ nodeCount, cameraName, ...result });
      console.log(
        `${String(nodeCount).padStart(6)} ${cameraName.padEnd(8)} ` +
        `${String(result.metrics.drawnNodes).padStart(6)} nodes / ` +
        `${String(result.metrics.drawnLinks).padStart(6)} links / ` +
        `${result.classificationMs.p50.toFixed(3)} ms p50`
      );
    }
  }

  const report = {
    schemaVersion: 1,
    experiment: "PERF-010A1-node",
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
    configuration: { sizes, cameras },
    results
  };
  const outputPath = resolve(values.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`PERF-010A1 Node written to ${outputPath}`);
}

await run();
