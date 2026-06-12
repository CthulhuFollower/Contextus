import { createIndexedDbSyncStore } from "../sync/indexeddb-store.js";
import {
  PERF_009_SCENARIOS,
  PERF_009_TOPOLOGIES,
  createPerf009Fixture,
  seedPerf009Store,
  summarizeStartupProfiles
} from "./perf-009-core.js";

const status = document.getElementById("status");
const output = document.getElementById("results");
const DEFAULT_SIZES = [1_000, 10_000, 50_000];

function parseList(name, fallback, convert = item => item) {
  const value = new URLSearchParams(location.search).get(name);
  return value
    ? value.split(",").map(item => convert(item.trim())).filter(item => item !== "")
    : fallback;
}

function sampleCount(size) {
  return size >= 50_000 ? 3 : 5;
}

async function prepareMeasurementOrigin() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map(registration => registration.unregister()));
}

async function seedDatabase(dbName, fixture) {
  const store = createIndexedDbSyncStore({ dbName });
  const engine = await seedPerf009Store(store, fixture);
  const db = await store.open();
  db.close();
  return {
    operationCount: engine.operations.length,
    privatePatchCount: engine.devicePatches.length
  };
}

function deleteDatabase(dbName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`No se pudo limpiar la base temporal ${dbName}.`));
  });
}

function runApplicationFrame(dbName, runId, cacheState) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    const timeout = setTimeout(() => {
      frame.remove();
      reject(new Error(`Timeout esperando arranque completo: ${runId}`));
    }, 120_000);
    const onMessage = event => {
      if (
        event.origin !== location.origin ||
        event.source !== frame.contentWindow ||
        event.data?.type !== "contextus-startup-profile" ||
        event.data?.report?.runId !== runId
      ) {
        return;
      }
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      const report = event.data.report;
      frame.remove();
      resolve(report);
    };
    window.addEventListener("message", onMessage);
    const query = new URLSearchParams({
      perfStartup: "1",
      perfStartupDb: dbName,
      perfStartupCache: cacheState,
      perfStartupRun: runId
    });
    frame.src = `../index.html?${query}`;
    document.body.append(frame);
  });
}

async function run() {
  await prepareMeasurementOrigin();
  const sizes = parseList("sizes", DEFAULT_SIZES, Number).filter(Number.isFinite);
  const topologies = parseList("topologies", PERF_009_TOPOLOGIES);
  const scenarios = parseList("scenarios", PERF_009_SCENARIOS);
  const results = [];

  for (const totalNodes of sizes) {
    for (const topology of topologies) {
      for (const scenario of scenarios) {
        const fixture = createPerf009Fixture({ totalNodes, topology, scenario });
        const profiles = [];
        for (let index = 0; index < sampleCount(totalNodes); index += 1) {
          status.textContent =
            `Midiendo ${totalNodes.toLocaleString()} nodos, ${topology}, ${scenario}, muestra ${index + 1}`;
          const dbName = `contextus-perf-009-${totalNodes}-${topology}-${scenario}-${index}`;
          await seedDatabase(dbName, fixture);
          profiles.push(await runApplicationFrame(
            dbName,
            `${dbName}-${Date.now()}`,
            index === 0 ? "first-navigation" : "repeat-navigation"
          ));
          await deleteDatabase(dbName);
        }
        const summary = summarizeStartupProfiles(profiles);
        results.push({ totalNodes, topology, scenario, profiles, summary });
        output.textContent = JSON.stringify({ results }, null, 2);
      }
    }
  }

  const report = {
    schemaVersion: 1,
    experiment: "PERF-009-browser",
    createdAt: new Date().toISOString(),
    environment: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory || null
    },
    configuration: { sizes, topologies, scenarios },
    results
  };
  output.textContent = JSON.stringify(report, null, 2);
  if (new URLSearchParams(location.search).get("report") === "1") {
    const response = await fetch("/__perf009_result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report)
    });
    if (!response.ok) throw new Error("El servidor local no pudo guardar el reporte.");
  }
  status.textContent = "Medicion completada.";
  status.dataset.state = "done";
}

run().catch(error => {
  console.error(error);
  status.textContent = `Error: ${error.message}`;
  status.dataset.state = "error";
});
