import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

import { createMentalMapDataset } from "./dataset-generator.js";
import {
  adaptiveDeleteTree,
  batchDeleteTree,
  buildChildrenByParentId,
  buildNodesById,
  indexedDeleteTree,
  indexedGetDescendants
} from "./indexed-algorithms.js";

const DEFAULT_SIZES = [1_000, 10_000, 50_000];
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

function measure({ name, size, scenario, operation, setup, samples }) {
  const warmupFixture = setup();
  blackhole += operation(warmupFixture);

  const timings = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const fixture = setup();
    const startedAt = performance.now();
    blackhole += operation(fixture);
    timings.push(performance.now() - startedAt);
  }

  return {
    name,
    size,
    scenario,
    status: "measured",
    warmups: 1,
    repeatsPerSample: 1,
    ...summarize(timings)
  };
}

function measureMemory({ name, size, scenario, operation, setup }) {
  if (!globalThis.gc) return null;

  const fixture = setup();
  globalThis.gc();
  const beforeBytes = process.memoryUsage().heapUsed;
  blackhole += operation(fixture);
  const afterOperationBytes = process.memoryUsage().heapUsed;
  globalThis.gc();
  const afterGcBytes = process.memoryUsage().heapUsed;

  return {
    name,
    size,
    scenario,
    beforeBytes,
    afterOperationBytes,
    afterGcBytes,
    transientDeltaBytes: afterOperationBytes - beforeBytes,
    retainedDeltaBytes: afterGcBytes - beforeBytes
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

function indexedFixture(dataset, rootNodeId) {
  const copy = structuredClone(dataset);
  return {
    ...copy,
    rootNodeId,
    nodesById: buildNodesById(copy.nodes),
    childrenByParentId: buildChildrenByParentId(copy.nodes)
  };
}

function subtreeSizes(nodes) {
  const sizes = new Map(nodes.map(node => [node.id, 1]));
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.parentId !== null) {
      sizes.set(node.parentId, (sizes.get(node.parentId) || 1) + sizes.get(node.id));
    }
  }
  return sizes;
}

function rootClosestToFraction(nodes, fraction) {
  const sizes = subtreeSizes(nodes);
  let best = nodes[1];
  let bestDistance = Infinity;

  for (const node of nodes) {
    if (node.isCenter) continue;
    const distance = Math.abs(sizes.get(node.id) / nodes.length - fraction);
    if (distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }

  return { rootNodeId: best.id, deletedNodeCount: sizes.get(best.id) };
}

async function run() {
  const { values } = parseArgs({
    options: {
      sizes: { type: "string" },
      "note-size": { type: "string", default: "100" },
      output: { type: "string", default: "performance/results/perf-003.json" }
    }
  });

  const sizes = parseSizes(values.sizes);
  const noteSize = Number(values["note-size"]);
  const outputPath = resolve(values.output);
  const results = [];
  const scenarios = [];
  const memory = [];
  const largestSize = Math.max(...sizes);

  for (const size of sizes) {
    const balanced4 = createMentalMapDataset({
      nodeCount: size,
      shape: "balanced",
      branchingFactor: 4,
      noteSize
    });
    const balanced2 = createMentalMapDataset({
      nodeCount: size,
      shape: "balanced",
      branchingFactor: 2,
      noteSize
    });
    const scenarioDefinitions = [
      {
        name: "leaf",
        dataset: balanced4,
        rootNodeId: balanced4.nodes.at(-1).id,
        deletedNodeCount: 1
      },
      {
        name: "small-near-1pct",
        dataset: balanced4,
        ...rootClosestToFraction(balanced4.nodes, 0.01)
      },
      {
        name: "medium-near-25pct",
        dataset: balanced4,
        ...rootClosestToFraction(balanced4.nodes, 0.25)
      },
      {
        name: "large-near-50pct",
        dataset: balanced2,
        ...rootClosestToFraction(balanced2.nodes, 0.5)
      }
    ];

    for (const scenario of scenarioDefinitions) {
      const setup = () => indexedFixture(scenario.dataset, scenario.rootNodeId);
      const samples = size >= 50_000 ? 3 : 7;
      scenarios.push({
        size,
        name: scenario.name,
        rootNodeId: scenario.rootNodeId,
        deletedNodeCount: scenario.deletedNodeCount,
        deletedFraction: scenario.deletedNodeCount / size
      });

      results.push(measure({
        name: "perf-002.node.deleteTree",
        size,
        scenario: scenario.name,
        setup,
        samples,
        operation: fixture => indexedDeleteTree(fixture)
      }));
      results.push(measure({
        name: "perf-003.node.deleteTree.batch",
        size,
        scenario: scenario.name,
        setup,
        samples,
        operation: fixture => batchDeleteTree(fixture)
      }));
      results.push(measure({
        name: "perf-003.node.deleteTree.adaptive",
        size,
        scenario: scenario.name,
        setup,
        samples,
        operation: fixture => adaptiveDeleteTree(fixture)
      }));

      if (size === largestSize) {
        for (const candidate of [
          { name: "perf-002.node.deleteTree", operation: indexedDeleteTree },
          { name: "perf-003.node.deleteTree.batch", operation: batchDeleteTree },
          { name: "perf-003.node.deleteTree.adaptive", operation: adaptiveDeleteTree }
        ]) {
          const measurement = measureMemory({
            name: candidate.name,
            size,
            scenario: scenario.name,
            setup,
            operation: fixture => candidate.operation(fixture)
          });
          if (measurement) memory.push(measurement);
        }
      }
    }
  }

  const report = {
    schemaVersion: 1,
    experiment: "PERF-003",
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
    configuration: { sizes, noteSize },
    scenarios,
    memory,
    results,
    blackhole
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`PERF-003 written to ${outputPath}`);
  for (const result of results) {
    console.log(
      `${String(result.size).padStart(6)}  ${result.scenario.padEnd(18)}  ` +
      `${result.name.padEnd(36)} ${result.p50Ms.toFixed(3)} ms p50 / ${result.p95Ms.toFixed(3)} ms p95`
    );
  }
}

await run();
