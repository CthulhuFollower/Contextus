import { createIndexedDbSyncStore } from "../sync/indexeddb-store.js";
import { LocalSyncEngine } from "../sync/local-sync-engine.js";
import { cloneValue } from "../sync/workspace-model.js";
import { createPerf004Fixture } from "./perf-004-core.js";

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

async function rawOperationRecords(dbName) {
  const db = await requestResult(indexedDB.open(dbName));
  const transaction = db.transaction(["operations"], "readonly");
  const records = await requestResult(transaction.objectStore("operations").getAll());
  await transactionComplete(transaction);
  db.close();
  return records;
}

async function createLegacyV2Database(dbName, fixture) {
  await requestResult(indexedDB.deleteDatabase(dbName));
  const request = indexedDB.open(dbName, 2);
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
  const dbName = "contextus-perf-005-recovery";
  const store = createIndexedDbSyncStore({ dbName });
  await store.clear();
  const fixture = createPerf004Fixture({ nodeCount: 1_000, scenario: "edit-text" });
  const engine = new LocalSyncEngine({ store });
  await engine.initialize({
    legacyState: fixture.initialWorkspace,
    workspaceId: fixture.initialSharedSnapshot.workspaceId,
    deviceId: fixture.initialDeviceSnapshot.deviceId
  });

  await engine.recordSharedChange(
    fixture.change.type,
    fixture.change.target,
    fixture.change.payload
  );
  const rawRecords = await rawOperationRecords(dbName);
  assert(rawRecords.length === 1, "La operacion incremental no se guardo.");
  assert(rawRecords[0].operation, "La operacion no se guardo dentro de su registro durable.");
  assert(rawRecords[0].revision === 1, "La revision no se guardo atomicamente con la operacion.");
  assert(rawRecords[0].parentCheckpointVersion === 1, "La operacion no referencia su checkpoint padre.");
  const afterOperation = cloneValue(engine.sharedSnapshot);
  const restartedAfterOperation = await restart(dbName);
  assert(
    sameState(restartedAfterOperation.sharedSnapshot, afterOperation),
    "El reinicio despues de guardar una operacion no reconstruyo el mismo estado."
  );

  const checkpoint = cloneValue(restartedAfterOperation.sharedSnapshot);
  checkpoint.compactedVector = cloneValue(checkpoint.vector);
  await restartedAfterOperation.store.publishCheckpoint(checkpoint);
  const retained = await restartedAfterOperation.store.load();
  assert(retained.operations.length === 1, "La publicacion limpio operaciones antes de confirmarse.");
  const restartedAfterPublish = await restart(dbName);
  assert(
    sameState(restartedAfterPublish.sharedSnapshot, checkpoint),
    "El reinicio entre publicacion y limpieza no reconstruyo el checkpoint."
  );

  await restartedAfterPublish.store.pruneOperations([]);
  await restartedAfterPublish.store.pruneCheckpoints();
  await restartedAfterPublish.recordSharedChange("node.move", fixture.change.target, {
    position: { x: 321, y: -123 }
  });
  const latest = cloneValue(restartedAfterPublish.sharedSnapshot);
  const restartedWithPending = await restart(dbName);
  assert(
    sameState(restartedWithPending.sharedSnapshot, latest),
    "El reinicio con operaciones posteriores al checkpoint no reconstruyo el estado."
  );

  const loaded = await restartedWithPending.store.load();
  const legacyDbName = "contextus-perf-005-legacy-v2";
  await createLegacyV2Database(legacyDbName, fixture);
  const upgraded = await restart(legacyDbName);
  const upgradedLoad = await upgraded.store.load();
  assert(
    sameState(upgraded.sharedSnapshot, fixture.initialSharedSnapshot),
    "La adopcion automatica de IndexedDB v2 altero el snapshot."
  );
  assert(upgradedLoad.persistence.activeCheckpoint, "IndexedDB v2 no adopto un checkpoint activo.");
  await upgraded.store.clear();

  const report = {
    checks: [
      "operacion, revision, secuencia y checkpoint padre atomicos",
      "reinicio despues de operacion incremental",
      "reinicio despues de publicar antes de limpiar",
      "reinicio con operaciones pendientes posteriores al checkpoint",
      "adopcion automatica de IndexedDB v2"
    ],
    activeCheckpoint: loaded.persistence.activeCheckpoint,
    pendingOperations: loaded.operations.length
  };
  output.textContent = JSON.stringify(report, null, 2);
  status.textContent = "Recuperacion verificada.";
  status.dataset.state = "done";
  await restartedWithPending.store.clear();
}

run().catch(error => {
  console.error(error);
  status.textContent = `Error: ${error.message}`;
  status.dataset.state = "error";
});
