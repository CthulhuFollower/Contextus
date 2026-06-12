import { createIndexedDbSyncStore } from "../sync/indexeddb-store.js";
import { LocalSyncEngine } from "../sync/local-sync-engine.js";
import {
  applyOperation,
  applyOperationMutable
} from "../sync/merge-engine.js";
import { cloneValue } from "../sync/workspace-model.js";
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

function operationForFixture(fixture) {
  return {
    operationId: `operation_perf006_${fixture.nodeCount}_${fixture.scenario}`,
    workspaceId: fixture.initialSharedSnapshot.workspaceId,
    deviceId: fixture.initialDeviceSnapshot.deviceId,
    sequence: 1,
    context: {},
    clock: {
      wallTime: 10_000,
      counter: 0,
      deviceId: fixture.initialDeviceSnapshot.deviceId
    },
    type: fixture.change.type,
    target: cloneValue(fixture.change.target),
    payload: cloneValue(fixture.change.payload)
  };
}

async function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(timestamp => resolve(timestamp)));
}

async function measuredCommit(engine, store, fixture) {
  const startedAt = performance.now();
  const taskResponse = new Promise(resolve => {
    setTimeout(() => resolve(performance.now() - startedAt), 0);
  });
  const frameResponse = new Promise(resolve => {
    requestAnimationFrame(() => resolve(performance.now() - startedAt));
  });
  const commit = await runPerf004Commit(engine, store, fixture);
  const completeMs = performance.now() - startedAt;
  const [uiTaskResponseMs, firstFrameResponseMs] = await Promise.all([taskResponse, frameResponse]);
  await nextFrame();
  return {
    commit,
    completeMs,
    uiTaskResponseMs,
    firstFrameResponseMs,
    postCommitFrameMs: performance.now() - startedAt
  };
}

function measureApplication(fixture) {
  const operation = operationForFixture(fixture);
  let startedAt = performance.now();
  const pure = applyOperation(fixture.initialSharedSnapshot, operation);
  const pureMs = performance.now() - startedAt;

  const mutableInput = cloneValue(fixture.initialSharedSnapshot);
  startedAt = performance.now();
  const mutable = applyOperationMutable(mutableInput, operation);
  const mutableMs = performance.now() - startedAt;

  if (JSON.stringify(pure) !== JSON.stringify(mutable)) {
    throw new Error("La aplicacion pura y mutable divergieron.");
  }
  return { pureMs, mutableMs };
}

async function measureScenario(fixture, sampleId) {
  const application = measureApplication(fixture);
  const dbName = `contextus-perf-006-${fixture.nodeCount}-${fixture.scenario}-${sampleId}`;
  const store = new ProfilingSyncStore(createIndexedDbSyncStore({ dbName }));
  await store.clear();
  const engine = new LocalSyncEngine({ store });
  await engine.initialize({
    legacyState: fixture.initialWorkspace,
    workspaceId: fixture.initialSharedSnapshot.workspaceId,
    deviceId: fixture.initialDeviceSnapshot.deviceId
  });
  store.resetProfile();
  const commit = await measuredCommit(engine, store, fixture);
  await store.clear();
  return { application, commit };
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
      results.push({
        size,
        scenario,
        application: {
          pureMs: summarizeMetric(samples, sample => sample.application.pureMs),
          mutableMs: summarizeMetric(samples, sample => sample.application.mutableMs)
        },
        commit: {
          recordSharedChangeMs: summarizeMetric(
            samples,
            sample => sample.commit.commit.stages.recordSharedChangeMs
          ),
          commitCompleteMs: summarizeMetric(
            samples,
            sample => sample.commit.commit.stages.commitCompleteMs
          ),
          uiTaskResponseMs: summarizeMetric(samples, sample => sample.commit.uiTaskResponseMs),
          postCommitFrameMs: summarizeMetric(samples, sample => sample.commit.postCommitFrameMs)
        }
      });
      output.textContent = JSON.stringify({ results }, null, 2);
      await nextFrame();
    }
  }

  const report = {
    schemaVersion: 1,
    experiment: "PERF-006-browser",
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
