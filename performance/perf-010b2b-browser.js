import { createIndexedDbSyncStore } from "../sync/indexeddb-store.js";
import {
  createPerf010A1Fixture
} from "./perf-010a1-core.js";
import {
  PERF_010B2B_MODES,
  PERF_010B2B_VELOCITY_FIXTURES,
  summarizePerf010B2BProfiles
} from "./perf-010b2b-core.js";

const DEFAULT_CAMERAS = ["normal", "dense", "zoom-out"];
const status = document.getElementById("status");
const output = document.getElementById("results");
const searchParams = new URLSearchParams(location.search);
const requestedSamples = Number(searchParams.get("samples"));

function parseList(name, fallback, convert = item => item) {
  const value = searchParams.get(name);
  return value
    ? value.split(",").map(item => convert(item.trim())).filter(item => item !== "")
    : fallback;
}

function sampleCount(nodeCount) {
  if (Number.isInteger(requestedSamples) && requestedSamples > 0) return requestedSamples;
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

function runApplicationFrame(dbName, runId, { mode, velocityFixture }) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    const timeout = setTimeout(() => {
      frame.remove();
      reject(new Error(`Timeout esperando PERF-010B2B: ${runId}`));
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
      perfLinkSegmentCulling: "1",
      perfLinkAdaptiveDiagnostics: "1",
      perfLinkAdaptiveMode: mode,
      perfDisableStarWebGL: "1"
    });
    if (velocityFixture !== "none") {
      query.set("perfLinkAdaptiveVelocityFixture", velocityFixture);
    }
    frame.src = `../index.html?${query}`;
    document.body.append(frame);
  });
}

async function run() {
  await prepareMeasurementOrigin();
  const sizes = parseList("sizes", [50_000], Number).filter(Number.isFinite);
  const cameras = parseList("cameras", DEFAULT_CAMERAS);
  const requestedModes = parseList("modes", PERF_010B2B_MODES)
    .filter(value => PERF_010B2B_MODES.includes(value));
  const modes = requestedModes.length ? requestedModes : PERF_010B2B_MODES;
  const velocityFixtures = parseList("velocityFixtures", ["none", "medium"])
    .filter(value => PERF_010B2B_VELOCITY_FIXTURES.includes(value));
  const results = [];

  for (const nodeCount of sizes) {
    for (const cameraName of cameras) {
      const fixture = createPerf010A1Fixture({ nodeCount, cameraName });
      for (const velocityFixture of velocityFixtures) {
        for (const mode of modes) {
          const profiles = [];
          for (let index = 0; index < sampleCount(nodeCount); index += 1) {
            status.textContent =
              `${nodeCount.toLocaleString()} nodos, ${cameraName}, ${velocityFixture}, ${mode}, muestra ${index + 1}`;
            const dbName =
              `contextus-perf-010b2b-${nodeCount}-${cameraName}-${velocityFixture}-${mode}-${index}`;
            await seedDatabase(dbName, fixture);
            profiles.push(
              await runApplicationFrame(dbName, `${dbName}-${Date.now()}`, {
                mode,
                velocityFixture
              })
            );
            await deleteDatabase(dbName);
            await waitForBrowserSettle();
          }
          results.push({
            nodeCount,
            cameraName,
            velocityFixture,
            mode,
            profiles,
            summary: summarizePerf010B2BProfiles(profiles)
          });
          output.textContent = JSON.stringify({ results }, null, 2);
        }
      }
    }
  }

  const report = {
    schemaVersion: 1,
    experiment: "PERF-010B2B-browser",
    createdAt: new Date().toISOString(),
    environment: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory || null
    },
    configuration: {
      sizes,
      cameras,
      velocityFixtures,
      modes
    },
    results
  };
  output.textContent = JSON.stringify(report, null, 2);
  if (searchParams.get("report") === "1") {
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
