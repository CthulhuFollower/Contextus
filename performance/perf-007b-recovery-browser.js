import { createIndexedDbSyncStore } from "../sync/indexeddb-store.js";
import { LocalSyncEngine } from "../sync/local-sync-engine.js";
import { createPerf007BFixture } from "./perf-007b-core.js";

const status = document.getElementById("status");
const output = document.getElementById("results");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sameState(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function createV3Database(dbName, fixture) {
  await requestResult(indexedDB.deleteDatabase(dbName));
  const request = indexedDB.open(dbName, 3);
  request.onupgradeneeded = () => {
    const db = request.result;
    db.createObjectStore("snapshots", { keyPath: "id" });
    const transactions = db.createObjectStore("transactions", { keyPath: "id" });
    transactions.createIndex("status", "status", { unique: false });
    transactions.createIndex("createdAt", "createdAt", { unique: false });
    db.createObjectStore("meta", { keyPath: "key" });
    const operations = db.createObjectStore("operations", { keyPath: "operationId" });
    operations.createIndex("deviceId", "deviceId", { unique: false });
    operations.createIndex("sequence", ["deviceId", "sequence"], { unique: true });
  };
  const db = await requestResult(request);
  const transaction = db.transaction(["snapshots"], "readwrite");
  const snapshots = transaction.objectStore("snapshots");
  snapshots.put({ id: "shared-current", schemaVersion: 1, state: fixture.initialSharedSnapshot });
  snapshots.put({ id: "device-current", schemaVersion: 1, state: fixture.initialDeviceSnapshot });
  await transactionComplete(transaction);
  db.close();
}

async function restart(dbName) {
  const engine = new LocalSyncEngine({ store: createIndexedDbSyncStore({ dbName }) });
  await engine.initialize();
  return engine;
}

async function run() {
  const dbName = "contextus-perf-007b-recovery";
  const fixture = createPerf007BFixture({ nodeCount: 1_000, scenario: "map-camera" });
  await createV3Database(dbName, fixture);

  const upgraded = await restart(dbName);
  assert(
    sameState(upgraded.deviceSnapshot, fixture.initialDeviceSnapshot),
    "La actualizacion desde IndexedDB v3 altero device-current."
  );
  await upgraded.recordDevicePatches([fixture.patch]);
  const afterPatch = structuredClone(upgraded.deviceSnapshot);
  const loaded = await upgraded.store.load();
  assert(loaded.devicePatches.length === 1, "El parche privado no se guardo.");
  assert(loaded.devicePatches[0].revision === 1, "La revision privada no se guardo.");
  assert(loaded.privatePersistence.revision === 1, "La cabecera privada no avanzo atomicamente.");
  assert(
    sameState(loaded.deviceSnapshot, fixture.initialDeviceSnapshot),
    "La interaccion incremental sobrescribio device-current."
  );

  const restarted = await restart(dbName);
  assert(sameState(restarted.deviceSnapshot, afterPatch), "El reinicio no reprodujo el parche privado.");
  await restarted.saveDeviceState(restarted.deviceSnapshot);
  const afterFullSave = await restarted.store.load();
  assert(afterFullSave.devicePatches.length === 0, "El guardado completo no limpio parches representados.");
  assert(afterFullSave.privatePersistence.revision === 0, "El nuevo checkpoint privado no reinicio revision.");

  output.textContent = JSON.stringify({
    checks: [
      "adopcion automatica de IndexedDB v3",
      "parche y revision privados atomicos",
      "device-current intacto durante interaccion incremental",
      "replay exacto despues de reinicio",
      "guardado completo establece nuevo checkpoint privado"
    ]
  }, null, 2);
  status.textContent = "Recuperacion privada verificada.";
  status.dataset.state = "done";
  await restarted.store.clear();
}

run().catch(error => {
  console.error(error);
  status.textContent = `Error: ${error.message}`;
  status.dataset.state = "error";
});
