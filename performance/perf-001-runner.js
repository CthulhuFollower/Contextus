import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

import {
  baselineDrawLinks,
  baselineGetNodeById,
  estimateDrawLinkFindComparisons
} from "./baseline-algorithms.js";
import { createMentalMapDataset } from "./dataset-generator.js";
import {
  buildNodesById,
  indexedDrawLinks,
  indexedGetNodeById
} from "./indexed-algorithms.js";

const DEFAULT_SIZES = [1_000, 10_000, 50_000];
const DEFAULT_MAX_WORK = 150_000_000;
let blackhole = 0;

function percentile(sorted, fraction) {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)];
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    samples: sorted.length,
    minMs: sorted[0],
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1)
  };
}

function measure({
  name,
  size,
  operation,
  samples = 7,
  repeats = 1,
  workEstimate = null,
  maxWork
}) {
  if (workEstimate !== null && workEstimate > maxWork) {
    return {
      name,
      size,
      status: "guarded-skip",
      workEstimate,
      maxWork,
      reason: "Estimated primitive comparisons exceed the configured safety budget."
    };
  }

  const warmupValue = operation();
  blackhole += typeof warmupValue === "number" ? warmupValue : Number(Boolean(warmupValue));

  const timings = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const startedAt = performance.now();
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const value = operation();
      blackhole += typeof value === "number" ? value : Number(Boolean(value));
    }
    timings.push((performance.now() - startedAt) / repeats);
  }

  return {
    name,
    size,
    status: "measured",
    warmups: 1,
    repeatsPerSample: repeats,
    workEstimate,
    ...summarize(timings)
  };
}

function parseSizes(value) {
  if (!value) return DEFAULT_SIZES;
  return value.split(",").map(item => Number(item.trim())).filter(Number.isFinite);
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

async function run() {
  const { values } = parseArgs({
    options: {
      sizes: { type: "string" },
      "note-size": { type: "string", default: "100" },
      "max-work": { type: "string", default: String(DEFAULT_MAX_WORK) },
      output: { type: "string", default: "performance/results/perf-001.json" }
    }
  });

  const sizes = parseSizes(values.sizes);
  const noteSize = Number(values["note-size"]);
  const maxWork = Number(values["max-work"]);
  const outputPath = resolve(values.output);
  const results = [];
  const memory = [];

  for (const size of sizes) {
    const dataset = createMentalMapDataset({ nodeCount: size, shape: "balanced", noteSize });
    const nodesById = buildNodesById(dataset.nodes);
    const baselineDrawWork = estimateDrawLinkFindComparisons(dataset.links);

    results.push(measure({
      name: "baseline.node.getById.end",
      size,
      repeats: 100,
      workEstimate: size,
      maxWork,
      operation: () => baselineGetNodeById(dataset.nodes, size)?.id || 0
    }));

    results.push(measure({
      name: "perf-001.node.getById.end",
      size,
      repeats: 100_000,
      workEstimate: 1,
      maxWork,
      operation: () => indexedGetNodeById(nodesById, size)?.id || 0
    }));

    results.push(measure({
      name: "perf-001.index.rebuild",
      size,
      samples: 5,
      workEstimate: size,
      maxWork,
      operation: () => buildNodesById(dataset.nodes).size
    }));

    results.push(measure({
      name: "baseline.render.drawLinks.balanced",
      size,
      samples: size >= 10_000 ? 3 : 5,
      workEstimate: baselineDrawWork,
      maxWork,
      operation: () => baselineDrawLinks(dataset)
    }));

    results.push(measure({
      name: "perf-001.render.drawLinks.balanced",
      size,
      samples: size >= 10_000 ? 3 : 5,
      workEstimate: dataset.links.length,
      maxWork,
      operation: () => indexedDrawLinks({ ...dataset, nodesById })
    }));

    let indexHeapBytes = null;
    if (globalThis.gc) {
      globalThis.gc();
      const before = process.memoryUsage().heapUsed;
      let measuredIndex = buildNodesById(dataset.nodes);
      globalThis.gc();
      indexHeapBytes = Math.max(0, process.memoryUsage().heapUsed - before);
      blackhole += measuredIndex.size;
      measuredIndex = null;
      globalThis.gc();
    }

    memory.push({
      size,
      indexHeapBytes,
      bytesPerNode: indexHeapBytes === null ? null : indexHeapBytes / size
    });
  }

  const report = {
    schemaVersion: 1,
    experiment: "PERF-001",
    createdAt: new Date().toISOString(),
    environment: {
      node: process.version,
      v8: process.versions.v8,
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model || null,
      gcExposed: Boolean(globalThis.gc)
    },
    git: getGitState(),
    configuration: { sizes, noteSize, maxWork },
    memory,
    results,
    blackhole
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`PERF-001 written to ${outputPath}`);
  for (const result of results) {
    const value = result.status === "measured"
      ? `${result.p50Ms.toFixed(3)} ms p50 / ${result.p95Ms.toFixed(3)} ms p95`
      : `SKIPPED (${result.workEstimate.toLocaleString()} estimated comparisons)`;
    console.log(`${String(result.size).padStart(6)}  ${result.name.padEnd(45)} ${value}`);
  }
}

await run();
