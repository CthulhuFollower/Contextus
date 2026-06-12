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
  return size >= 50_000 ? 2 : 3;
}

function summarizeMetric(samples, read) {
  return summarizeSamples(samples.map(read));
}

function storeCall(sample, name) {
  return sample.storeCalls.find(call => call.name === name);
}

async function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(timestamp => resolve(timestamp)));
}

async function measuredAction(action) {
  const startedAt = performance.now();
  const taskResponse = new Promise(resolve => {
    setTimeout(() => resolve(performance.now() - startedAt), 0);
  });
  const frameResponse = new Promise(resolve => {
    requestAnimationFrame(() => resolve(performance.now() - startedAt));
  });
  const value = await action();
  const completeMs = performance.now() - startedAt;
  const [uiTaskResponseMs, firstFrameResponseMs] = await Promise.all([taskResponse, frameResponse]);
  await nextFrame();
  return {
    value,
    completeMs,
    uiTaskResponseMs,
    firstFrameResponseMs,
    postCompleteFrameMs: performance.now() - startedAt
  };
}

async function measureScenario(fixture, sampleId) {
  const dbName = `contextus-perf-005-${fixture.nodeCount}-${fixture.scenario}-${sampleId}`;
  const store = new ProfilingSyncStore(createIndexedDbSyncStore({ dbName }));
  await store.clear();
  const engine = new LocalSyncEngine({ store });
  await engine.initialize({
    legacyState: fixture.initialWorkspace,
    workspaceId: fixture.initialSharedSnapshot.workspaceId,
    deviceId: fixture.initialDeviceSnapshot.deviceId
  });
  store.resetProfile();

  const commit = await measuredAction(() => runPerf004Commit(engine, store, fixture));
  store.resetProfile();
  const checkpoint = await measuredAction(() => engine.compact());
  const checkpointCalls = structuredClone(store.calls);
  await store.clear();

  return {
    commit: {
      ...commit.value,
      responsiveness: commit
    },
    checkpoint: {
      responsiveness: checkpoint,
      storeCalls: checkpointCalls
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
        samples.push(await measureScenario(createPerf004Fixture({ nodeCount: size, scenario }), index));
      }

      const result = {
        size,
        scenario,
        incrementalCommit: {
          indexedDbSharedMs: summarizeMetric(
            samples,
            sample => storeCall(sample.commit, "commitShared")?.durationMs || 0
          ),
          logicalSharedBytes: summarizeMetric(
            samples,
            sample => storeCall(sample.commit, "commitShared")?.result?.logicalBytesWritten || 0
          ),
          commitCompleteMs: summarizeMetric(
            samples,
            sample => sample.commit.stages.commitCompleteMs
          ),
          uiTaskResponseMs: summarizeMetric(
            samples,
            sample => sample.commit.responsiveness.uiTaskResponseMs
          ),
          postCommitFrameMs: summarizeMetric(
            samples,
            sample => sample.commit.responsiveness.postCompleteFrameMs
          )
        },
        checkpoint: {
          completeMs: summarizeMetric(
            samples,
            sample => sample.checkpoint.responsiveness.completeMs
          ),
          uiTaskResponseMs: summarizeMetric(
            samples,
            sample => sample.checkpoint.responsiveness.uiTaskResponseMs
          ),
          indexedDbPublishMs: summarizeMetric(
            samples,
            sample => storeCall(sample.checkpoint, "publishCheckpoint")?.durationMs || 0
          ),
          logicalBytes: summarizeMetric(
            samples,
            sample => storeCall(sample.checkpoint, "publishCheckpoint")?.result?.logicalBytesWritten || 0
          )
        }
      };
      results.push(result);
      output.textContent = JSON.stringify({ results }, null, 2);
      await nextFrame();
    }
  }

  const report = {
    schemaVersion: 1,
    experiment: "PERF-005-browser",
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
