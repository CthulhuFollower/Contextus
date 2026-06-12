import { createIndexedDbSyncStore } from "../sync/indexeddb-store.js";
import { LocalSyncEngine } from "../sync/local-sync-engine.js";
import { createPerf008AFixture } from "./perf-008a-core.js";

const status = document.getElementById("status");
const output = document.getElementById("results");

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
    transaction.onabort = () => reject(transaction.error || new Error("Transaccion abortada."));
  });
}

function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function historicalPatches(mapSyncId) {
  return [
    { patchId: "camera-a-1", revision: 1, type: "setMapCamera", mapSyncId, camera: { x: 1, y: -1, zoom: 1 } },
    { patchId: "selected-a-1", revision: 2, type: "setSelectedNode", mapSyncId, selectedNodeSyncId: "node-a" },
    { patchId: "camera-b-1", revision: 3, type: "setMapCamera", mapSyncId: "map-b", camera: { x: 3, y: -3, zoom: 1 } },
    { patchId: "camera-a-2", revision: 4, type: "setMapCamera", mapSyncId, camera: { x: 4, y: -4, zoom: 2 } },
    { patchId: "active-1", revision: 5, type: "setActiveMap", activeMapSyncId: "map-b" },
    { patchId: "selected-a-2", revision: 6, type: "setSelectedNode", mapSyncId, selectedNodeSyncId: null }
  ];
}

async function createV4Database(dbName, fixture) {
  await requestResult(indexedDB.deleteDatabase(dbName));
  const request = indexedDB.open(dbName, 4);
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
    const patches = db.createObjectStore("devicePatches", { keyPath: "patchId" });
    patches.createIndex("revision", "revision", { unique: true });
  };
  const db = await requestResult(request);
  const patches = historicalPatches(fixture.patch.mapSyncId);
  const transaction = db.transaction(["snapshots", "devicePatches", "meta"], "readwrite");
  const snapshots = transaction.objectStore("snapshots");
  snapshots.put({ id: "shared-current", schemaVersion: 1, state: fixture.initialSharedSnapshot });
  snapshots.put({ id: "device-current", schemaVersion: 1, state: fixture.initialDeviceSnapshot });
  for (const patch of patches) {
    transaction.objectStore("devicePatches").put({
      patchId: patch.patchId,
      revision: patch.revision,
      byteLength: jsonBytes(patch),
      patch
    });
  }
  transaction.objectStore("meta").put({
    key: "privatePersistenceHead",
    value: {
      revision: 9,
      patchCount: patches.length,
      patchBytes: patches.reduce((total, patch) => total + jsonBytes(patch), 0)
    }
  });
  await transactionComplete(transaction);
  db.close();
}

async function abortReplacement(store, patchKey) {
  const db = await store.open();
  const transaction = db.transaction(["devicePatches", "meta"], "readwrite");
  const patches = transaction.objectStore("devicePatches");
  const previous = await requestResult(patches.get(patchKey));
  patches.put({
    ...previous,
    revision: previous.revision + 1,
    patch: {
      ...previous.patch,
      revision: previous.revision + 1,
      camera: { x: 999, y: -999, zoom: 9 }
    }
  });
  transaction.objectStore("meta").put({
    key: "privatePersistenceHead",
    value: { revision: 999, patchCount: 999, patchBytes: 999 }
  });
  const completion = transactionComplete(transaction);
  transaction.abort();
  try {
    await completion;
  } catch {
    return;
  }
  throw new Error("La transaccion de reemplazo no fue abortada.");
}

async function run() {
  const dbName = "contextus-perf-008a-recovery";
  const fixture = createPerf008AFixture({ nodeCount: 1_000, scenario: "map-camera" });
  await createV4Database(dbName, fixture);
  const store = createIndexedDbSyncStore({ dbName });
  const engine = new LocalSyncEngine({ store });
  await engine.initialize();
  const migrated = await store.load();

  assert(migrated.devicePatches.length === 4, "La migracion v4 no coalescio por clave.");
  assert(migrated.privatePersistence.patchCount === 4, "patchCount no representa las claves actuales.");
  assert(migrated.privatePersistence.revision === 9, "La migracion no conservo la revision maxima.");
  assert(
    migrated.privatePersistence.patchBytes ===
      migrated.devicePatches.reduce((total, patch) => total + jsonBytes(patch), 0),
    "patchBytes no representa los parches coalescidos."
  );
  assert(
    engine.deviceSnapshot.mapStates[fixture.patch.mapSyncId].camera.x === 4,
    "La migracion no conservo la ultima camara."
  );
  assert(
    engine.deviceSnapshot.mapStates[fixture.patch.mapSyncId].selectedNodeSyncId === null,
    "La migracion no conservo la ultima seleccion."
  );

  const beforeAbort = await store.load();
  await abortReplacement(store, `mapCamera:${fixture.patch.mapSyncId}`);
  const afterAbort = await store.load();
  assert(
    JSON.stringify(afterAbort.devicePatches) === JSON.stringify(beforeAbort.devicePatches),
    "Un corte durante reemplazo altero el parche durable anterior."
  );
  assert(
    JSON.stringify(afterAbort.privatePersistence) === JSON.stringify(beforeAbort.privatePersistence),
    "Un corte durante reemplazo altero la cabecera privada."
  );

  output.textContent = JSON.stringify({
    checks: [
      "migracion automatica IndexedDB v4 a v5",
      "ultimo parche por clave estructural",
      "revision maxima conservada",
      "patchCount y patchBytes recalculados",
      "replay exacto de valores finales",
      "reemplazo y cabecera restaurados tras aborto"
    ]
  }, null, 2);
  status.textContent = "Migracion y recuperacion coalescida verificadas.";
  status.dataset.state = "done";
  await store.clear();
}

run().catch(error => {
  console.error(error);
  status.textContent = `Error: ${error.message}`;
  status.dataset.state = "error";
});
