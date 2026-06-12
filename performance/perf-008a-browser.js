import { createIndexedDbSyncStore } from "../sync/indexeddb-store.js";
import { LocalSyncEngine } from "../sync/local-sync-engine.js";
import { summarizeSamples } from "./perf-004-core.js";
import {
  PERF_008A_SCENARIOS,
  createPerf008AFixture,
  nextPrivatePatch,
  privateGrowthPatch,
  sameStructuredValue
} from "./perf-008a-core.js";

const status = document.getElementById("status");
const output = document.getElementById("results");
const GROWTH_PATTERNS = ["same-map-camera", "three-map-camera", "mixed-interleaved"];

function parseList(name, fallback) {
  const value = new URLSearchParams(location.search).get(name);
  return value ? value.split(",").map(item => item.trim()).filter(Boolean) : fallback;
}

function samplesForSize(size) {
  return size >= 50_000 ? 7 : 5;
}

async function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

async function createEngine(dbName, fixture) {
  const store = createIndexedDbSyncStore({ dbName });
  await store.clear();
  const engine = new LocalSyncEngine({ store });
  await engine.initialize({
    legacyState: fixture.initialWorkspace,
    workspaceId: fixture.initialSharedSnapshot.workspaceId,
    deviceId: fixture.initialDeviceSnapshot.deviceId
  });
  return { engine, store };
}

async function measureReplacement(fixture, sampleId) {
  const dbName = `contextus-perf-008a-${fixture.nodeCount}-${fixture.scenario}-${sampleId}`;
  const { engine, store } = await createEngine(dbName, fixture);
  await engine.recordDevicePatches([fixture.patch]);
  const replacement = nextPrivatePatch(fixture.patch, 1);
  const startedAt = performance.now();
  const uiTask = new Promise(resolve => setTimeout(() => resolve(performance.now() - startedAt), 0));
  const persisted = await engine.recordDevicePatches([replacement]);
  const result = {
    commitCompleteMs: performance.now() - startedAt,
    logicalBytesWritten: persisted.persistence?.logicalBytesWritten || 0,
    patchCount: engine.devicePatches.length,
    patchBytes: engine.privatePatchLogBytes,
    revision: engine.privateRevision,
    exact: JSON.stringify(engine.deviceSnapshot) !== JSON.stringify(fixture.initialDeviceSnapshot)
  };
  const uiTaskResponseMs = await uiTask;
  await store.clear();
  return { ...result, uiTaskResponseMs };
}

async function measureGrowth(nodeCount, pattern) {
  const fixture = createPerf008AFixture({ nodeCount, scenario: "map-camera" });
  const dbName = `contextus-perf-008a-growth-${pattern}-${nodeCount}`;
  const { engine, store } = await createEngine(dbName, fixture);
  const checkpointBefore = JSON.stringify((await store.load()).deviceSnapshot);
  const startedAt = performance.now();
  for (let index = 1; index <= 1_000; index += 1) {
    await engine.recordDevicePatches([privateGrowthPatch(pattern, index)]);
  }
  const writeMs = performance.now() - startedAt;
  const loaded = await store.load();
  const restartStartedAt = performance.now();
  const restarted = new LocalSyncEngine({ store: createIndexedDbSyncStore({ dbName }) });
  await restarted.initialize();
  const result = {
    pattern,
    interactions: 1_000,
    patches: loaded.devicePatches.length,
    patchBytes: loaded.privatePersistence.patchBytes,
    revision: loaded.privatePersistence.revision,
    writeMs,
    restartMs: performance.now() - restartStartedAt,
    exact: sameStructuredValue(restarted.deviceSnapshot, engine.deviceSnapshot),
    checkpointUnchanged: JSON.stringify(loaded.deviceSnapshot) === checkpointBefore
  };
  await store.clear();
  return result;
}

async function loadPerf007BBaseline() {
  try {
    const response = await fetch("./results/perf-007b-browser.json");
    return (await response.json()).growth;
  } catch {
    return null;
  }
}

async function run() {
  const sizes = parseList("sizes", ["1000", "10000", "50000"]).map(Number);
  const scenarios = parseList("scenarios", PERF_008A_SCENARIOS);
  const results = [];

  for (const size of sizes) {
    for (const scenario of scenarios) {
      status.textContent = `Midiendo reemplazo ${size.toLocaleString()} nodos: ${scenario}`;
      const samples = [];
      for (let index = 0; index < samplesForSize(size); index += 1) {
        samples.push(await measureReplacement(
          createPerf008AFixture({ nodeCount: size, scenario }),
          index
        ));
      }
      if (samples.some(sample => sample.patchCount !== 1 || sample.revision !== 2 || !sample.exact)) {
        throw new Error(`El reemplazo coalescido incumplio una invariante en ${size} ${scenario}.`);
      }
      results.push({
        size,
        scenario,
        commitCompleteMs: summarizeSamples(samples.map(sample => sample.commitCompleteMs)),
        uiTaskResponseMs: summarizeSamples(samples.map(sample => sample.uiTaskResponseMs)),
        logicalBytesWritten: summarizeSamples(samples.map(sample => sample.logicalBytesWritten)),
        patchBytes: summarizeSamples(samples.map(sample => sample.patchBytes))
      });
      output.textContent = JSON.stringify({ results }, null, 2);
      await nextFrame();
    }
  }

  const growth = [];
  for (const pattern of GROWTH_PATTERNS) {
    status.textContent = `Midiendo 1,000 interacciones: ${pattern}`;
    const result = await measureGrowth(Math.max(...sizes), pattern);
    if (!result.exact || !result.checkpointUnchanged) {
      throw new Error(`El crecimiento coalescido incumplio una invariante en ${pattern}.`);
    }
    growth.push(result);
  }

  const report = {
    schemaVersion: 1,
    experiment: "PERF-008A-browser",
    createdAt: new Date().toISOString(),
    environment: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory || null
    },
    configuration: { sizes, scenarios, interactions: 1_000 },
    perf007bGrowthBaseline: await loadPerf007BBaseline(),
    growth,
    results
  };
  output.textContent = JSON.stringify(report, null, 2);
  status.textContent = "Medicion completada.";
  status.dataset.state = "done";
}

run().catch(error => {
  console.error(error);
  status.textContent = `Error: ${error.message}`;
  status.dataset.state = "error";
});
