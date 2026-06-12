import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { arch, cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";

import {
  baselineDeleteTree,
  baselineDrawLinks,
  baselineGetChildren,
  baselineGetDescendants,
  baselineGetMapById,
  baselineGetNodeById,
  estimateDrawLinkFindComparisons
} from "./baseline-algorithms.js";
import {
  countSubtreeNodes,
  createMapList,
  createMentalMapDataset
} from "./dataset-generator.js";

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

function sampleCountFor(size, expensive = false) {
  if (expensive) return size >= 10_000 ? 3 : 5;
  if (size >= 50_000) return 7;
  return 11;
}

function repeatsFor(size) {
  if (size >= 50_000) return 5;
  if (size >= 10_000) return 20;
  return 100;
}

function measure({ name, size, operation, setup = null, samples, repeats = 1, workEstimate = null, maxWork }) {
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

  const warmupFixture = setup ? setup() : undefined;
  const warmupValue = operation(warmupFixture);
  if (typeof warmupValue === "number") blackhole += warmupValue;
  else if (warmupValue) blackhole += 1;

  const timings = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const fixture = setup ? setup() : undefined;
    const startedAt = performance.now();
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const value = operation(fixture);
      if (typeof value === "number") blackhole += value;
      else if (value) blackhole += 1;
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

function parseSizes(value) {
  if (!value) return DEFAULT_SIZES;
  return value.split(",").map(item => Number(item.trim())).filter(Number.isFinite);
}

function bytesOf(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function mib(bytes) {
  return bytes / (1024 * 1024);
}

async function run() {
  const { values } = parseArgs({
    options: {
      sizes: { type: "string" },
      "note-size": { type: "string", default: "100" },
      "max-work": { type: "string", default: String(DEFAULT_MAX_WORK) },
      output: { type: "string", default: "performance/results/baseline.json" }
    }
  });

  const sizes = parseSizes(values.sizes);
  const noteSize = Number(values["note-size"]);
  const maxWork = Number(values["max-work"]);
  const outputPath = resolve(values.output);
  const results = [];
  const datasets = [];

  for (const size of sizes) {
    const generation = measure({
      name: "dataset.generate.balanced",
      size,
      samples: sampleCountFor(size, true),
      maxWork,
      operation: () => createMentalMapDataset({ nodeCount: size, shape: "balanced", noteSize }).nodes.length
    });
    results.push(generation);

    const balanced = createMentalMapDataset({ nodeCount: size, shape: "balanced", noteSize });
    const deep = createMentalMapDataset({ nodeCount: size, shape: "deep", noteSize });
    const maps = createMapList(size);
    const serializedBytes = bytesOf(balanced.map);
    let heapDeltaBytes = null;

    if (globalThis.gc) {
      globalThis.gc();
      const before = process.memoryUsage().heapUsed;
      const memoryFixture = createMentalMapDataset({ nodeCount: size, shape: "balanced", noteSize });
      globalThis.gc();
      heapDeltaBytes = Math.max(0, process.memoryUsage().heapUsed - before);
      blackhole += memoryFixture.nodes.length;
    }

    datasets.push({
      size,
      noteSize,
      nodes: balanced.nodes.length,
      links: balanced.links.length,
      serializedBytes,
      serializedMiB: mib(serializedBytes),
      heapDeltaBytes,
      heapDeltaMiB: heapDeltaBytes === null ? null : mib(heapDeltaBytes)
    });

    results.push(measure({
      name: "node.getById.end",
      size,
      samples: sampleCountFor(size),
      repeats: repeatsFor(size),
      workEstimate: size,
      maxWork,
      operation: () => baselineGetNodeById(balanced.nodes, size)?.id || 0
    }));

    results.push(measure({
      name: "node.getById.missing",
      size,
      samples: sampleCountFor(size),
      repeats: repeatsFor(size),
      workEstimate: size,
      maxWork,
      operation: () => baselineGetNodeById(balanced.nodes, -1)?.id || 0
    }));

    results.push(measure({
      name: "node.getChildren.root",
      size,
      samples: sampleCountFor(size),
      repeats: repeatsFor(size),
      workEstimate: size,
      maxWork,
      operation: () => baselineGetChildren(balanced.nodes, 1).length
    }));

    results.push(measure({
      name: "node.getDescendants.root.balanced",
      size,
      samples: sampleCountFor(size, true),
      workEstimate: size * size,
      maxWork,
      operation: () => baselineGetDescendants(balanced.nodes, 1).length
    }));

    results.push(measure({
      name: "node.getDescendants.root.deep",
      size,
      samples: sampleCountFor(size, true),
      workEstimate: size * size,
      maxWork,
      operation: () => baselineGetDescendants(deep.nodes, 1).length
    }));

    const drawComparisons = estimateDrawLinkFindComparisons(balanced.links);
    results.push(measure({
      name: "render.drawLinks.balanced",
      size,
      samples: sampleCountFor(size, true),
      workEstimate: drawComparisons,
      maxWork,
      operation: () => baselineDrawLinks(balanced)
    }));

    const deletionRoot = balanced.nodes[1]?.id;
    const subtreeSize = deletionRoot ? countSubtreeNodes(balanced.nodes, deletionRoot) : 0;
    results.push(measure({
      name: "node.deleteTree.firstRootChild",
      size,
      samples: sampleCountFor(size, true),
      workEstimate: subtreeSize * size,
      maxWork,
      setup: () => ({
        nodes: structuredClone(balanced.nodes),
        links: structuredClone(balanced.links)
      }),
      operation: fixture => baselineDeleteTree(fixture.nodes, fixture.links, deletionRoot)
    }));

    results.push(measure({
      name: "map.getById.end",
      size,
      samples: sampleCountFor(size),
      repeats: repeatsFor(size),
      workEstimate: size,
      maxWork,
      operation: () => baselineGetMapById(maps, size)?.id || 0
    }));
  }

  const report = {
    schemaVersion: 1,
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
    datasets,
    results,
    blackhole
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`Baseline written to ${outputPath}`);
  for (const result of results) {
    const value = result.status === "measured"
      ? `${result.p50Ms.toFixed(3)} ms p50 / ${result.p95Ms.toFixed(3)} ms p95`
      : `SKIPPED (${result.workEstimate.toLocaleString()} estimated comparisons)`;
    console.log(`${String(result.size).padStart(6)}  ${result.name.padEnd(40)} ${value}`);
  }
}

await run();
