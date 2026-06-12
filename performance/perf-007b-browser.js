import { createIndexedDbSyncStore } from "../sync/indexeddb-store.js";
import { LocalSyncEngine } from "../sync/local-sync-engine.js";
import { ProfilingSyncStore, summarizeSamples } from "./perf-004-core.js";
import {
  PERF_007B_SCENARIOS,
  createPerf007BFixture,
  runPerf007BCommit
} from "./perf-007b-core.js";

const status = document.getElementById("status");
const output = document.getElementById("results");

function parseList(name, fallback) {
  const value = new URLSearchParams(location.search).get(name);
  return value ? value.split(",").map(item => item.trim()).filter(Boolean) : fallback;
}

function samplesForSize(size) {
  return size >= 50_000 ? 7 : 5;
}

function summarizeMetric(samples, read) {
  return summarizeSamples(samples.map(read));
}

async function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(timestamp => resolve(timestamp)));
}

async function measuredCommit(engine, store, fixture, useFullSnapshot) {
  const startedAt = performance.now();
  const taskResponse = new Promise(resolve => {
    setTimeout(() => resolve(performance.now() - startedAt), 0);
  });
  const frameResponse = new Promise(resolve => {
    requestAnimationFrame(() => resolve(performance.now() - startedAt));
  });
  const commit = await runPerf007BCommit(engine, store, fixture, { useFullSnapshot });
  const [uiTaskResponseMs, firstFrameResponseMs] = await Promise.all([taskResponse, frameResponse]);
  await nextFrame();
  return {
    commit,
    uiTaskResponseMs,
    firstFrameResponseMs,
    postCommitFrameMs: performance.now() - startedAt
  };
}

async function measureRoute(fixture, sampleId, route, useFullSnapshot) {
  const dbName = `contextus-perf-007b-${fixture.nodeCount}-${fixture.scenario}-${route}-${sampleId}`;
  const store = new ProfilingSyncStore(createIndexedDbSyncStore({ dbName }));
  await store.clear();
  const engine = new LocalSyncEngine({ store });
  await engine.initialize({
    legacyState: fixture.initialWorkspace,
    workspaceId: fixture.initialSharedSnapshot.workspaceId,
    deviceId: fixture.initialDeviceSnapshot.deviceId
  });
  store.resetProfile();
  const result = await measuredCommit(engine, store, fixture, useFullSnapshot);
  await store.clear();
  return result;
}

function summarizeRoute(samples) {
  return {
    captureWorkspaceMs: summarizeMetric(samples, sample => sample.commit.stages.captureWorkspaceMs),
    preparePrivateMs: summarizeMetric(samples, sample => sample.commit.stages.preparePrivateMs),
    persistPrivateMs: summarizeMetric(samples, sample => sample.commit.stages.persistPrivateMs),
    commitCompleteMs: summarizeMetric(samples, sample => sample.commit.stages.commitCompleteMs),
    uiTaskResponseMs: summarizeMetric(samples, sample => sample.uiTaskResponseMs),
    firstFrameResponseMs: summarizeMetric(samples, sample => sample.firstFrameResponseMs),
    postCommitFrameMs: summarizeMetric(samples, sample => sample.postCommitFrameMs),
    privateLogicalBytes: summarizeMetric(samples, sample => sample.commit.privateLogicalBytes)
  };
}

async function measureGrowth(nodeCount) {
  const fixture = createPerf007BFixture({ nodeCount, scenario: "map-camera" });
  const dbName = `contextus-perf-007b-growth-${nodeCount}`;
  const store = createIndexedDbSyncStore({ dbName });
  await store.clear();
  const engine = new LocalSyncEngine({ store });
  await engine.initialize({
    legacyState: fixture.initialWorkspace,
    workspaceId: fixture.initialSharedSnapshot.workspaceId,
    deviceId: fixture.initialDeviceSnapshot.deviceId
  });
  const mapSyncId = fixture.patch.mapSyncId;
  const checkpointBefore = JSON.stringify((await store.load()).deviceSnapshot);
  const startedAt = performance.now();
  for (let index = 1; index <= 1_000; index += 1) {
    await engine.recordDevicePatches([{
      type: "setMapCamera",
      mapSyncId,
      camera: { x: index, y: -index, zoom: 1 + index / 1_000 }
    }]);
  }
  const writeMs = performance.now() - startedAt;
  const loaded = await store.load();
  const restartStartedAt = performance.now();
  const restarted = new LocalSyncEngine({ store: createIndexedDbSyncStore({ dbName }) });
  await restarted.initialize();
  const restartMs = performance.now() - restartStartedAt;
  const exact = JSON.stringify(restarted.deviceSnapshot) === JSON.stringify(engine.deviceSnapshot);
  const checkpointUnchanged = JSON.stringify(loaded.deviceSnapshot) === checkpointBefore;
  await store.clear();
  return {
    interactions: 1_000,
    patches: loaded.devicePatches.length,
    patchBytes: loaded.privatePersistence.patchBytes,
    writeMs,
    restartMs,
    exact,
    checkpointUnchanged
  };
}

async function run() {
  const sizes = parseList("sizes", ["1000", "10000", "50000"]).map(Number);
  const scenarios = parseList("scenarios", PERF_007B_SCENARIOS);
  const results = [];

  for (const size of sizes) {
    for (const scenario of scenarios) {
      status.textContent = `Midiendo ${size.toLocaleString()} nodos: ${scenario}`;
      const full = [];
      const incremental = [];
      for (let index = 0; index < samplesForSize(size); index += 1) {
        full.push(await measureRoute(
          createPerf007BFixture({ nodeCount: size, scenario }),
          index,
          "full",
          true
        ));
        incremental.push(await measureRoute(
          createPerf007BFixture({ nodeCount: size, scenario }),
          index,
          "incremental",
          false
        ));
      }
      if (incremental.some(sample =>
        sample.commit.privatePatchCalls !== 1 ||
        sample.commit.privateSnapshotCalls !== 0 ||
        !sample.commit.checkpointUnchanged ||
        !sample.commit.observableMatchesExpected
      )) {
        throw new Error(`La ruta privada incremental incumplio una invariante en ${size} ${scenario}.`);
      }
      results.push({
        size,
        scenario,
        full: summarizeRoute(full),
        incremental: summarizeRoute(incremental)
      });
      output.textContent = JSON.stringify({ results }, null, 2);
      await nextFrame();
    }
  }

  status.textContent = "Midiendo crecimiento de 1,000 parches...";
  const growth = await measureGrowth(Math.max(...sizes));
  if (!growth.exact || !growth.checkpointUnchanged) {
    throw new Error("El replay de 1,000 parches no reconstruyo el estado exacto.");
  }
  const report = {
    schemaVersion: 1,
    experiment: "PERF-007B-browser",
    createdAt: new Date().toISOString(),
    environment: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory || null
    },
    configuration: { sizes, scenarios },
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
