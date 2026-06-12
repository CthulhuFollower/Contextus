import { createIndexedDbSyncStore } from "../sync/indexeddb-store.js";
import {
  PERF_010A1_CAMERAS,
  createPerf010A1Fixture
} from "./perf-010a1-core.js";
import { summarizePerf010B0Profiles } from "./perf-010b0-core.js";

const status = document.getElementById("status");
const output = document.getElementById("results");

function parseList(name, fallback, convert = item => item) {
  const value = new URLSearchParams(location.search).get(name);
  return value
    ? value.split(",").map(item => convert(item.trim())).filter(item => item !== "")
    : fallback;
}

function sampleCount(nodeCount) {
  return nodeCount >= 50_000 ? 3 : 5;
}

async function prepareMeasurementOrigin() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map(registration => registration.unregister()));
}

async function seedDatabase(dbName, fixture) {
  const store = createIndexedDbSyncStore({ dbName });
  await store.clear();
  await store.writeMigration({
    sharedSnapshot: fixture.sharedSnapshot,
    deviceSnapshot: fixture.deviceSnapshot
  });
  const db = await store.open();
  db.close();
}

function deleteDatabase(dbName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`No se pudo limpiar la base temporal ${dbName}.`));
  });
}

function waitForBrowserSettle() {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function runApplicationFrame(dbName, runId) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    const timeout = setTimeout(() => {
      frame.remove();
      reject(new Error(`Timeout esperando PERF-010B0: ${runId}`));
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
      frame.remove();
      resolve(event.data.report);
    };
    window.addEventListener("message", onMessage);
    const query = new URLSearchParams({
      perfStartup: "1",
      perfStartupDb: dbName,
      perfStartupRun: runId,
      perfRenderCulling: "1",
      perfLinkDiagnostics: "1",
      perfDisableStarWebGL: "1"
    });
    frame.src = `../index.html?${query}`;
    document.body.append(frame);
  });
}

async function run() {
  await prepareMeasurementOrigin();
  const sizes = parseList("sizes", [50_000], Number).filter(Number.isFinite);
  const cameras = parseList("cameras", PERF_010A1_CAMERAS);
  const results = [];

  for (const nodeCount of sizes) {
    for (const cameraName of cameras) {
      const fixture = createPerf010A1Fixture({ nodeCount, cameraName });
      const profiles = [];
      for (let index = 0; index < sampleCount(nodeCount); index += 1) {
        status.textContent =
          `${nodeCount.toLocaleString()} nodos, ${cameraName}, muestra ${index + 1}`;
        const dbName = `contextus-perf-010b0-${nodeCount}-${cameraName}-${index}`;
        await seedDatabase(dbName, fixture);
        profiles.push(await runApplicationFrame(dbName, `${dbName}-${Date.now()}`));
        await deleteDatabase(dbName);
        await waitForBrowserSettle();
      }
      results.push({
        nodeCount,
        cameraName,
        profiles,
        summary: summarizePerf010B0Profiles(profiles)
      });
      output.textContent = JSON.stringify({ results }, null, 2);
    }
  }

  const report = {
    schemaVersion: 1,
    experiment: "PERF-010B0-browser",
    createdAt: new Date().toISOString(),
    environment: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory || null
    },
    configuration: { sizes, cameras },
    results
  };
  output.textContent = JSON.stringify(report, null, 2);
  if (new URLSearchParams(location.search).get("report") === "1") {
    const response = await fetch("/__perf_result", {
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
