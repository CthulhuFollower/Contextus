import { createIndexedDbSyncStore } from "../sync/indexeddb-store.js";
import { LocalSyncEngine } from "../sync/local-sync-engine.js";
import {
  PERF_004_SCENARIOS,
  ProfilingSyncStore,
  createPerf004Fixture,
  runPerf004Commit,
  summarizeSamples
} from "./perf-004-core.js";

const status = document.getElementById("status");
const output = document.getElementById("results");

function parseList(name, fallback) {
  const value = new URLSearchParams(location.search).get(name);
  return value ? value.split(",").map(item => item.trim()).filter(Boolean) : fallback;
}

function samplesForSize(size) {
  if (size >= 50_000) return 2;
  return 3;
}

function summarizeMetric(samples, read) {
  return summarizeSamples(samples.map(read));
}

async function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(timestamp => resolve(timestamp)));
}

async function measureBrowserCommit(fixture, sampleId) {
  const dbName = `contextus-perf-004-${fixture.nodeCount}-${fixture.scenario}-${sampleId}`;
  const delegate = createIndexedDbSyncStore({ dbName });
  const store = new ProfilingSyncStore(delegate);
  await store.clear();
  const engine = new LocalSyncEngine({ store });
  await engine.initialize({
    legacyState: fixture.initialWorkspace,
    workspaceId: fixture.initialSharedSnapshot.workspaceId,
    deviceId: fixture.initialDeviceSnapshot.deviceId
  });
  store.resetProfile();

  const userActionStartedAt = performance.now();
  const taskResponse = new Promise(resolve => {
    setTimeout(() => resolve(performance.now() - userActionStartedAt), 0);
  });
  const frameResponse = new Promise(resolve => {
    requestAnimationFrame(() => resolve(performance.now() - userActionStartedAt));
  });

  const commit = await runPerf004Commit(engine, store, fixture);
  const [uiTaskResponseMs, firstFrameResponseMs] = await Promise.all([taskResponse, frameResponse]);
  await nextFrame();
  const postCommitFrameMs = performance.now() - userActionStartedAt;
  await store.clear();

  return {
    ...commit,
    responsiveness: {
      uiTaskResponseMs,
      firstFrameResponseMs,
      postCommitFrameMs
    }
  };
}

async function run() {
  const sizes = parseList("sizes", ["1000", "10000", "50000"]).map(Number);
  const scenarios = parseList("scenarios", PERF_004_SCENARIOS);
  const results = [];

  for (const size of sizes) {
    for (const scenario of scenarios) {
      status.textContent = `Midiendo ${size.toLocaleString()} nodos: ${scenario}`;
      const samples = [];
      for (let index = 0; index < samplesForSize(size); index += 1) {
        const fixture = createPerf004Fixture({ nodeCount: size, scenario });
        samples.push(await measureBrowserCommit(fixture, index));
      }

      const storeDuration = (sample, name) =>
        sample.storeCalls.find(call => call.name === name)?.durationMs || 0;
      const fixture = createPerf004Fixture({ nodeCount: size, scenario });
      results.push({
        size,
        scenario,
        deletedNodeCount: fixture.deletedNodeCount,
        metrics: {
          captureWorkspaceMs: summarizeMetric(samples, sample => sample.stages.captureWorkspaceMs),
          captureDeviceMs: summarizeMetric(samples, sample => sample.stages.captureDeviceMs),
          recordSharedChangeMs: summarizeMetric(samples, sample => sample.stages.recordSharedChangeMs),
          indexedDbSharedMs: summarizeMetric(samples, sample => storeDuration(sample, "commitShared")),
          saveDeviceStateMs: summarizeMetric(samples, sample => sample.stages.saveDeviceStateMs),
          indexedDbDeviceMs: summarizeMetric(samples, sample => storeDuration(sample, "saveDevice")),
          commitCompleteMs: summarizeMetric(samples, sample => sample.stages.commitCompleteMs),
          uiTaskResponseMs: summarizeMetric(samples, sample => sample.responsiveness.uiTaskResponseMs),
          firstFrameResponseMs: summarizeMetric(samples, sample => sample.responsiveness.firstFrameResponseMs),
          postCommitFrameMs: summarizeMetric(samples, sample => sample.responsiveness.postCommitFrameMs),
          serializationMs: summarizeMetric(samples, sample => sample.serializationMs.total)
        },
        bytes: samples[0].bytes
      });
      output.textContent = JSON.stringify({ results }, null, 2);
      await nextFrame();
    }
  }

  const report = {
    schemaVersion: 1,
    experiment: "PERF-004-browser",
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
