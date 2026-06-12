import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

import {
  baselineGetChildren,
  baselineGetDescendants
} from "./baseline-algorithms.js";
import {
  countSubtreeNodes,
  createMentalMapDataset
} from "./dataset-generator.js";
import {
  buildChildrenByParentId,
  buildNodesById,
  deleteTreeWithNodesById,
  indexedDeleteTree,
  indexedGetChildren,
  indexedGetDescendants
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
  setup = null,
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

  const warmupFixture = setup ? setup() : undefined;
  const warmupValue = operation(warmupFixture);
  blackhole += typeof warmupValue === "number" ? warmupValue : Number(Boolean(warmupValue));

  const timings = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const fixture = setup ? setup() : undefined;
    const startedAt = performance.now();
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const value = operation(fixture);
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

function deletionFixture(dataset, includeChildrenIndex) {
  const copy = structuredClone(dataset);
  const fixture = {
    ...copy,
    nodesById: buildNodesById(copy.nodes),
    rootNodeId: copy.nodes[1]?.id
  };
  if (includeChildrenIndex) {
    fixture.childrenByParentId = buildChildrenByParentId(copy.nodes);
  }
  return fixture;
}

async function run() {
  const { values } = parseArgs({
    options: {
      sizes: { type: "string" },
      "note-size": { type: "string", default: "100" },
      "max-work": { type: "string", default: String(DEFAULT_MAX_WORK) },
      output: { type: "string", default: "performance/results/perf-002.json" }
    }
  });

  const sizes = parseSizes(values.sizes);
  const noteSize = Number(values["note-size"]);
  const maxWork = Number(values["max-work"]);
  const outputPath = resolve(values.output);
  const results = [];
  const memory = [];

  for (const size of sizes) {
    const balanced = createMentalMapDataset({ nodeCount: size, shape: "balanced", noteSize });
    const deep = createMentalMapDataset({ nodeCount: size, shape: "deep", noteSize });
    const balancedChildren = buildChildrenByParentId(balanced.nodes);
    const deepChildren = buildChildrenByParentId(deep.nodes);
    const subtreeSize = countSubtreeNodes(balanced.nodes, balanced.nodes[1].id);

    results.push(measure({
      name: "perf-001.node.getChildren.root",
      size,
      repeats: 100,
      workEstimate: size,
      maxWork,
      operation: () => baselineGetChildren(balanced.nodes, 1).length
    }));

    results.push(measure({
      name: "perf-002.node.getChildren.root",
      size,
      repeats: 100_000,
      workEstimate: 1,
      maxWork,
      operation: () => indexedGetChildren(balancedChildren, 1).length
    }));

    results.push(measure({
      name: "perf-002.index.rebuild",
      size,
      samples: 5,
      workEstimate: size,
      maxWork,
      operation: () => buildChildrenByParentId(balanced.nodes).size
    }));

    results.push(measure({
      name: "perf-001.node.getDescendants.root.balanced",
      size,
      samples: size >= 10_000 ? 3 : 5,
      workEstimate: size * size,
      maxWork,
      operation: () => baselineGetDescendants(balanced.nodes, 1).length
    }));

    results.push(measure({
      name: "perf-002.node.getDescendants.root.balanced",
      size,
      samples: 11,
      workEstimate: size,
      maxWork,
      operation: () => indexedGetDescendants(balancedChildren, 1).length
    }));

    results.push(measure({
      name: "perf-001.node.getDescendants.root.deep",
      size,
      samples: size >= 10_000 ? 3 : 5,
      workEstimate: size * size,
      maxWork,
      operation: () => baselineGetDescendants(deep.nodes, 1).length
    }));

    results.push(measure({
      name: "perf-002.node.getDescendants.root.deep",
      size,
      samples: 11,
      workEstimate: size,
      maxWork,
      operation: () => indexedGetDescendants(deepChildren, 1).length
    }));

    results.push(measure({
      name: "perf-001.node.deleteTree.firstRootChild",
      size,
      samples: size >= 10_000 ? 3 : 5,
      workEstimate: subtreeSize * size,
      maxWork,
      setup: () => deletionFixture(balanced, false),
      operation: fixture => deleteTreeWithNodesById(fixture)
    }));

    results.push(measure({
      name: "perf-002.node.deleteTree.firstRootChild",
      size,
      samples: size >= 10_000 ? 3 : 5,
      workEstimate: size * 3 + subtreeSize,
      maxWork,
      setup: () => deletionFixture(balanced, true),
      operation: fixture => indexedDeleteTree(fixture)
    }));

    let indexHeapBytes = null;
    if (globalThis.gc) {
      globalThis.gc();
      const before = process.memoryUsage().heapUsed;
      let measuredIndex = buildChildrenByParentId(balanced.nodes);
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
    experiment: "PERF-002",
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

  console.log(`PERF-002 written to ${outputPath}`);
  for (const result of results) {
    const value = result.status === "measured"
      ? `${result.p50Ms.toFixed(3)} ms p50 / ${result.p95Ms.toFixed(3)} ms p95`
      : `SKIPPED (${result.workEstimate.toLocaleString()} estimated comparisons)`;
    console.log(`${String(result.size).padStart(6)}  ${result.name.padEnd(52)} ${value}`);
  }
}

await run();
