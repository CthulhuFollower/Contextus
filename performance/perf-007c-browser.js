import { createIndexedDbSyncStore } from "../sync/indexeddb-store.js";
import { LocalSyncEngine } from "../sync/local-sync-engine.js";
import { ProfilingSyncStore, summarizeSamples } from "./perf-004-core.js";
import {
  PERF_007C_SCENARIOS,
  createPerf007CFixture,
  runPerf007CCommit
} from "./perf-007c-core.js";

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

async function measuredCommit(engine, store, fixture, forceWorkspaceCapture) {
  const startedAt = performance.now();
  const taskResponse = new Promise(resolve => {
    setTimeout(() => resolve(performance.now() - startedAt), 0);
  });
  const frameResponse = new Promise(resolve => {
    requestAnimationFrame(() => resolve(performance.now() - startedAt));
  });
  const commit = await runPerf007CCommit(engine, store, fixture, { forceWorkspaceCapture });
  const [uiTaskResponseMs, firstFrameResponseMs] = await Promise.all([taskResponse, frameResponse]);
  await nextFrame();
  return {
    commit,
    uiTaskResponseMs,
    firstFrameResponseMs,
    postCommitFrameMs: performance.now() - startedAt
  };
}

async function measureRoute(fixture, sampleId, route, forceWorkspaceCapture) {
  const dbName = `contextus-perf-007c-${fixture.nodeCount}-${fixture.scenario}-${route}-${sampleId}`;
  const store = new ProfilingSyncStore(createIndexedDbSyncStore({ dbName }));
  await store.clear();
  const engine = new LocalSyncEngine({ store });
  await engine.initialize({
    legacyState: fixture.initialWorkspace,
    workspaceId: fixture.initialSharedSnapshot.workspaceId,
    deviceId: fixture.initialDeviceSnapshot.deviceId
  });
  store.resetProfile();
  const result = await measuredCommit(engine, store, fixture, forceWorkspaceCapture);
  await store.clear();
  return result;
}

function summarizeRoute(samples) {
  return {
    captureWorkspaceMs: summarizeMetric(samples, sample => sample.commit.stages.captureWorkspaceMs),
    prepareSharedChangeMs: summarizeMetric(samples, sample => sample.commit.stages.prepareSharedChangeMs),
    recordSharedChangeMs: summarizeMetric(samples, sample => sample.commit.stages.recordSharedChangeMs),
    commitCompleteMs: summarizeMetric(samples, sample => sample.commit.stages.commitCompleteMs),
    uiTaskResponseMs: summarizeMetric(samples, sample => sample.uiTaskResponseMs),
    firstFrameResponseMs: summarizeMetric(samples, sample => sample.firstFrameResponseMs),
    postCommitFrameMs: summarizeMetric(samples, sample => sample.postCommitFrameMs),
    workspaceCaptureCalls: summarizeMetric(samples, sample => sample.commit.workspaceCaptureCalls)
  };
}

async function run() {
  const sizes = parseList("sizes", ["1000", "10000", "50000"]).map(Number);
  const scenarios = parseList("scenarios", PERF_007C_SCENARIOS);
  const results = [];

  for (const size of sizes) {
    for (const scenario of scenarios) {
      status.textContent = `Midiendo ${size.toLocaleString()} nodos: ${scenario}`;
      const captured = [];
      const fast = [];
      for (let index = 0; index < samplesForSize(size); index += 1) {
        captured.push(await measureRoute(
          createPerf007CFixture({ nodeCount: size, scenario }),
          index,
          "captured",
          true
        ));
        fast.push(await measureRoute(
          createPerf007CFixture({ nodeCount: size, scenario }),
          index,
          "fast",
          false
        ));
      }

      if (fast.some(sample =>
        sample.commit.workspaceCaptureCalls !== 0 ||
        !sample.commit.deviceSnapshotUnchanged ||
        !sample.commit.observableMatchesRuntime
      )) {
        throw new Error(`La ruta rapida incumplio una invariante en ${size} ${scenario}.`);
      }

      results.push({
        size,
        scenario,
        captured: summarizeRoute(captured),
        fast: summarizeRoute(fast)
      });
      output.textContent = JSON.stringify({ results }, null, 2);
      await nextFrame();
    }
  }

  const report = {
    schemaVersion: 1,
    experiment: "PERF-007C-browser",
    createdAt: new Date().toISOString(),
    environment: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory || null
    },
    configuration: { sizes, scenarios },
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
