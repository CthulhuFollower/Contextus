import { cloneValue } from "./workspace-model.js";
import {
  coalesceDevicePatches,
  getDevicePatchKey,
  sortDevicePatches
} from "./device-patches.js";
import {
  measureStartupAsync,
  measureStartupSync
} from "../runtime/startup-profiler.js";

export const LOCAL_DB_NAME = "contextus-local-first";
export const LOCAL_DB_VERSION = 5;
export const SHARED_SNAPSHOT_ID = "shared-current";
export const DEVICE_SNAPSHOT_ID = "device-current";
export const LEGACY_SNAPSHOT_ID = "current";

const ACTIVE_CHECKPOINT_META_KEY = "activeSharedCheckpoint";
const SHARED_HEAD_META_KEY = "sharedPersistenceHead";
const PRIVATE_HEAD_META_KEY = "privatePersistenceHead";
const SYNC_SCHEMA_VERSION = 4;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Transaccion IndexedDB abortada."));
  });
}

function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function snapshotRecord(id, state, metadata = {}) {
  return {
    id,
    schemaVersion: state?.schemaVersion || 1,
    savedAt: Date.now(),
    ...cloneValue(metadata),
    state: cloneValue(state)
  };
}

function createCheckpoint(previous = null) {
  const version = (previous?.version || 0) + 1;
  return {
    id: `shared-checkpoint-${version}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version
  };
}

function unwrapOperation(record) {
  return cloneValue(record?.operation || record);
}

function unwrapDevicePatch(record) {
  return {
    ...cloneValue(record?.patch || record),
    patchKey: record?.patchKey || record?.patch?.patchKey || getDevicePatchKey(record?.patch || record),
    revision: Number(record?.revision) || 0
  };
}

function createDevicePatchStore(db) {
  const patches = db.createObjectStore("devicePatches", { keyPath: "patchKey" });
  patches.createIndex("revision", "revision", { unique: true });
  return patches;
}

function devicePatchRecord(patch, revision, persistedAt = Date.now()) {
  const persistedPatch = {
    ...cloneValue(patch),
    patchKey: getDevicePatchKey(patch),
    revision
  };
  return {
    patchKey: persistedPatch.patchKey,
    patchId: persistedPatch.patchId,
    revision,
    byteLength: jsonBytes(persistedPatch),
    persistedAt,
    patch: persistedPatch
  };
}

function operationRecord(operation, metadata) {
  return {
    operationId: operation.operationId,
    deviceId: operation.deviceId,
    sequence: operation.sequence,
    revision: metadata.revision,
    parentCheckpointId: metadata.parentCheckpointId,
    parentCheckpointVersion: metadata.parentCheckpointVersion,
    byteLength: metadata.byteLength,
    persistedAt: Date.now(),
    operation: cloneValue(operation)
  };
}

function emptyHead(activeCheckpoint = null) {
  return {
    revision: 0,
    operationCount: 0,
    operationBytes: 0,
    checkpointId: activeCheckpoint?.id || null,
    checkpointVersion: activeCheckpoint?.version || 0,
    updatedAt: Date.now()
  };
}

function emptyPrivateHead() {
  return {
    revision: 0,
    patchCount: 0,
    patchBytes: 0,
    updatedAt: Date.now()
  };
}

function operationLogBytes(operations) {
  return (operations || []).reduce((total, operation) => total + jsonBytes(operation), 0);
}

export class IndexedDbSyncStore {
  constructor(options = {}) {
    this.dbName = options.dbName || LOCAL_DB_NAME;
    this.indexedDB = options.indexedDB || globalThis.indexedDB;
    this.profiler = options.profiler || null;
    this.dbPromise = null;
  }

  open() {
    if (!this.indexedDB) {
      return Promise.reject(new Error("IndexedDB no esta disponible."));
    }
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = measureStartupAsync(this.profiler, "persistence.indexeddb.open", () => new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.dbName, LOCAL_DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = request.result;
        const upgradeTransaction = request.transaction;

        if (!db.objectStoreNames.contains("snapshots")) {
          db.createObjectStore("snapshots", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("transactions")) {
          const transactions = db.createObjectStore("transactions", { keyPath: "id" });
          transactions.createIndex("status", "status", { unique: false });
          transactions.createIndex("createdAt", "createdAt", { unique: false });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("operations")) {
          const operations = db.createObjectStore("operations", { keyPath: "operationId" });
          operations.createIndex("deviceId", "deviceId", { unique: false });
          operations.createIndex("sequence", ["deviceId", "sequence"], { unique: true });
        }
        if (!db.objectStoreNames.contains("devicePatches")) {
          createDevicePatchStore(db);
        } else if (event.oldVersion < 5) {
          const legacyStore = upgradeTransaction.objectStore("devicePatches");
          const legacyPatchesRequest = legacyStore.getAll();
          const legacyHeadRequest = upgradeTransaction
            .objectStore("meta")
            .get(PRIVATE_HEAD_META_KEY);
          let historicalRecords = null;
          let historicalHead = null;
          const migratePrivatePatches = () => {
            if (historicalRecords === null || historicalHead === null) return;
            const historicalPatches = sortDevicePatches(
              historicalRecords.map(unwrapDevicePatch)
            );
            const coalescedPatches = coalesceDevicePatches(historicalPatches);
            const revision = Math.max(
              Number(historicalHead?.value?.revision) || 0,
              Number(historicalPatches.at(-1)?.revision) || 0
            );
            db.deleteObjectStore("devicePatches");
            const patchStore = createDevicePatchStore(db);
            let patchBytes = 0;
            for (const patch of coalescedPatches) {
              const record = devicePatchRecord(patch, Number(patch.revision) || 0);
              patchStore.put(record);
              patchBytes += record.byteLength;
            }
            upgradeTransaction.objectStore("meta").put({
              key: PRIVATE_HEAD_META_KEY,
              value: {
                revision,
                patchCount: coalescedPatches.length,
                patchBytes,
                updatedAt: Date.now()
              }
            });
            upgradeTransaction.objectStore("meta").put({
              key: "syncSchemaVersion",
              value: SYNC_SCHEMA_VERSION
            });
          };
          legacyPatchesRequest.onsuccess = () => {
            historicalRecords = legacyPatchesRequest.result || [];
            migratePrivatePatches();
          };
          legacyHeadRequest.onsuccess = () => {
            historicalHead = legacyHeadRequest.result || {};
            migratePrivatePatches();
          };
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        console.warn("La base local esta bloqueada por otra pestana.");
      };
    }));

    return this.dbPromise;
  }

  async load() {
    const endLoad = this.profiler?.start?.("persistence.load.total");
    const db = await this.open();
    const transaction = db.transaction(
      ["snapshots", "operations", "devicePatches", "meta"],
      "readonly"
    );
    const completion = transactionToPromise(transaction);
    const snapshots = transaction.objectStore("snapshots");
    const operations = transaction.objectStore("operations");
    const devicePatches = transaction.objectStore("devicePatches");
    const meta = transaction.objectStore("meta");

    try {
      const [activeRecord, headRecord, privateHeadRecord] = await measureStartupAsync(
        this.profiler,
        "persistence.load.meta",
        () => Promise.all([
          requestToPromise(meta.get(ACTIVE_CHECKPOINT_META_KEY)),
          requestToPromise(meta.get(SHARED_HEAD_META_KEY)),
          requestToPromise(meta.get(PRIVATE_HEAD_META_KEY))
        ])
      );
      const activeCheckpoint = measureStartupSync(
        this.profiler,
        "persistence.load.cloneActiveCheckpoint",
        () => cloneValue(activeRecord?.value || null)
      );
      const [shared, device, legacy, operationRecords, devicePatchRecords] = await measureStartupAsync(
        this.profiler,
        "persistence.load.records",
        () => Promise.all([
          requestToPromise(snapshots.get(activeCheckpoint?.id || SHARED_SNAPSHOT_ID)),
          requestToPromise(snapshots.get(DEVICE_SNAPSHOT_ID)),
          requestToPromise(snapshots.get(LEGACY_SNAPSHOT_ID)),
          requestToPromise(operations.getAll()),
          requestToPromise(devicePatches.index("revision").getAll())
        ])
      );
      await measureStartupAsync(this.profiler, "persistence.load.transactionComplete", () => completion);

      return measureStartupSync(this.profiler, "persistence.load.returnClone", () => {
        const head = cloneValue(headRecord?.value || emptyHead(activeCheckpoint));
        return {
          sharedSnapshot: cloneValue(shared?.state || null),
          deviceSnapshot: cloneValue(device?.state || null),
          legacySnapshot: cloneValue(legacy || null),
          operations: (operationRecords || []).map(unwrapOperation),
          devicePatches: (devicePatchRecords || []).map(unwrapDevicePatch),
          privatePersistence: cloneValue(privateHeadRecord?.value || emptyPrivateHead()),
          persistence: {
            ...head,
            activeCheckpoint
          }
        };
      });
    } finally {
      endLoad?.();
    }
  }

  async writeMigration({ sharedSnapshot, deviceSnapshot }) {
    const db = await this.open();
    const transaction = db.transaction(
      ["snapshots", "transactions", "operations", "devicePatches", "meta"],
      "readwrite"
    );
    const checkpoint = createCheckpoint();
    const head = emptyHead(checkpoint);
    const snapshots = transaction.objectStore("snapshots");
    const meta = transaction.objectStore("meta");
    const checkpointMetadata = {
      checkpointVersion: checkpoint.version,
      parentCheckpointId: null,
      parentCheckpointVersion: 0
    };

    snapshots.put(snapshotRecord(checkpoint.id, sharedSnapshot, checkpointMetadata));
    snapshots.put(snapshotRecord(SHARED_SNAPSHOT_ID, sharedSnapshot, checkpointMetadata));
    snapshots.put(snapshotRecord(DEVICE_SNAPSHOT_ID, deviceSnapshot));
    transaction.objectStore("transactions").clear();
    transaction.objectStore("operations").clear();
    transaction.objectStore("devicePatches").clear();
    meta.put({ key: "syncSchemaVersion", value: SYNC_SCHEMA_VERSION });
    meta.put({ key: "workspaceId", value: sharedSnapshot.workspaceId });
    meta.put({ key: "deviceId", value: deviceSnapshot.deviceId });
    meta.put({ key: "syncMigrationCompletedAt", value: Date.now() });
    meta.put({ key: ACTIVE_CHECKPOINT_META_KEY, value: checkpoint });
    meta.put({ key: SHARED_HEAD_META_KEY, value: head });
    meta.put({ key: PRIVATE_HEAD_META_KEY, value: emptyPrivateHead() });

    await transactionToPromise(transaction);
  }

  async ensureCheckpoint(sharedSnapshot, operations = []) {
    const loaded = await this.load();
    if (loaded.persistence?.activeCheckpoint) return loaded.persistence.activeCheckpoint;
    await this.replaceSyncState(sharedSnapshot, operations);
    return (await this.load()).persistence.activeCheckpoint;
  }

  async commitShared(sharedSnapshot, operation) {
    const db = await this.open();
    const transaction = db.transaction(["operations", "meta"], "readwrite");
    const completion = transactionToPromise(transaction);
    const operations = transaction.objectStore("operations");
    const meta = transaction.objectStore("meta");
    const [activeRecord, headRecord] = await Promise.all([
      requestToPromise(meta.get(ACTIVE_CHECKPOINT_META_KEY)),
      requestToPromise(meta.get(SHARED_HEAD_META_KEY))
    ]);

    const activeCheckpoint = cloneValue(activeRecord?.value || {
      id: SHARED_SNAPSHOT_ID,
      version: 0
    });
    const previousHead = cloneValue(headRecord?.value || emptyHead(activeCheckpoint));
    const byteLength = jsonBytes(operation);
    const metadata = {
      revision: (previousHead.revision || 0) + 1,
      parentCheckpointId: activeCheckpoint.id,
      parentCheckpointVersion: activeCheckpoint.version,
      byteLength
    };
    const record = operationRecord(operation, metadata);
    const head = {
      ...previousHead,
      revision: metadata.revision,
      deviceId: operation.deviceId,
      sequence: operation.sequence,
      operationCount: (previousHead.operationCount || 0) + 1,
      operationBytes: (previousHead.operationBytes || 0) + byteLength,
      checkpointId: activeCheckpoint.id,
      checkpointVersion: activeCheckpoint.version,
      updatedAt: Date.now()
    };

    operations.put(record);
    meta.put({ key: SHARED_HEAD_META_KEY, value: head });
    await completion;
    return {
      logicalBytesWritten: jsonBytes(record) + jsonBytes(head),
      metadata: cloneValue(metadata)
    };
  }

  async commitDevicePatches(patches) {
    const db = await this.open();
    const transaction = db.transaction(["devicePatches", "meta"], "readwrite");
    const completion = transactionToPromise(transaction);
    const patchStore = transaction.objectStore("devicePatches");
    const meta = transaction.objectStore("meta");
    const headRecord = await requestToPromise(meta.get(PRIVATE_HEAD_META_KEY));
    const previousHead = cloneValue(headRecord?.value || emptyPrivateHead());
    let revision = previousHead.revision || 0;
    let patchBytes = previousHead.patchBytes || 0;
    let patchCount = previousHead.patchCount || 0;
    const metadata = [];

    for (const patch of patches || []) {
      revision += 1;
      const patchKey = getDevicePatchKey(patch);
      const previous = await requestToPromise(patchStore.get(patchKey));
      const record = devicePatchRecord(patch, revision);
      patchBytes += record.byteLength - (Number(previous?.byteLength) || 0);
      if (!previous) patchCount += 1;
      patchStore.put(record);
      metadata.push({
        patchId: record.patchId,
        patchKey,
        revision,
        byteLength: record.byteLength,
        replacedByteLength: Number(previous?.byteLength) || 0
      });
    }

    const head = {
      revision,
      patchCount,
      patchBytes,
      updatedAt: Date.now()
    };
    meta.put({ key: PRIVATE_HEAD_META_KEY, value: head });
    await completion;
    return {
      metadata,
      head,
      logicalBytesWritten:
        metadata.reduce((total, item) => total + item.byteLength, 0) + jsonBytes(head)
    };
  }

  async saveDevice(deviceSnapshot) {
    const db = await this.open();
    const transaction = db.transaction(["snapshots", "devicePatches", "meta"], "readwrite");
    transaction.objectStore("snapshots").put(snapshotRecord(DEVICE_SNAPSHOT_ID, deviceSnapshot));
    transaction.objectStore("devicePatches").clear();
    transaction.objectStore("meta").put({ key: "deviceSavedAt", value: Date.now() });
    transaction.objectStore("meta").put({ key: PRIVATE_HEAD_META_KEY, value: emptyPrivateHead() });
    await transactionToPromise(transaction);
  }

  async publishCheckpoint(sharedSnapshot) {
    const db = await this.open();
    const transaction = db.transaction(["snapshots", "meta"], "readwrite");
    const completion = transactionToPromise(transaction);
    const snapshots = transaction.objectStore("snapshots");
    const meta = transaction.objectStore("meta");
    const [activeRecord, headRecord] = await Promise.all([
      requestToPromise(meta.get(ACTIVE_CHECKPOINT_META_KEY)),
      requestToPromise(meta.get(SHARED_HEAD_META_KEY))
    ]);

    const previous = cloneValue(activeRecord?.value || null);
    const checkpoint = createCheckpoint(previous);
    const previousHead = cloneValue(headRecord?.value || emptyHead(previous));
    const metadata = {
      checkpointVersion: checkpoint.version,
      parentCheckpointId: previous?.id || null,
      parentCheckpointVersion: previous?.version || 0
    };
    const record = snapshotRecord(checkpoint.id, sharedSnapshot, metadata);
    const head = {
      ...previousHead,
      revision: (previousHead.revision || 0) + 1,
      checkpointId: checkpoint.id,
      checkpointVersion: checkpoint.version,
      updatedAt: Date.now()
    };

    snapshots.put(record);
    meta.put({ key: ACTIVE_CHECKPOINT_META_KEY, value: checkpoint });
    meta.put({ key: SHARED_HEAD_META_KEY, value: head });
    meta.put({ key: "syncSchemaVersion", value: SYNC_SCHEMA_VERSION });
    meta.put({ key: "sharedSavedAt", value: Date.now() });
    await completion;

    return {
      checkpoint,
      previousCheckpoint: previous,
      logicalBytesWritten: jsonBytes(record) + jsonBytes(head)
    };
  }

  async pruneOperations(remainingOperations = []) {
    const db = await this.open();
    const transaction = db.transaction(["operations", "meta"], "readwrite");
    const completion = transactionToPromise(transaction);
    const operations = transaction.objectStore("operations");
    const meta = transaction.objectStore("meta");
    const [activeRecord, headRecord] = await Promise.all([
      requestToPromise(meta.get(ACTIVE_CHECKPOINT_META_KEY)),
      requestToPromise(meta.get(SHARED_HEAD_META_KEY))
    ]);
    const activeCheckpoint = cloneValue(activeRecord?.value || null);
    const previousHead = cloneValue(headRecord?.value || emptyHead(activeCheckpoint));
    const persistedOperations = cloneValue(remainingOperations || []);
    const bytes = operationLogBytes(persistedOperations);

    operations.clear();
    for (const operation of persistedOperations) {
      operations.put(operationRecord(operation, {
        revision: previousHead.revision || 0,
        parentCheckpointId: activeCheckpoint?.id || null,
        parentCheckpointVersion: activeCheckpoint?.version || 0,
        byteLength: jsonBytes(operation)
      }));
    }
    meta.put({
      key: SHARED_HEAD_META_KEY,
      value: {
        ...previousHead,
        revision: (previousHead.revision || 0) + 1,
        operationCount: persistedOperations.length,
        operationBytes: bytes,
        updatedAt: Date.now()
      }
    });
    await completion;
  }

  async pruneCheckpoints() {
    const db = await this.open();
    const transaction = db.transaction(["snapshots", "meta"], "readwrite");
    const completion = transactionToPromise(transaction);
    const snapshots = transaction.objectStore("snapshots");
    const meta = transaction.objectStore("meta");
    const activeRecord = await requestToPromise(meta.get(ACTIVE_CHECKPOINT_META_KEY));
    const activeCheckpoint = cloneValue(activeRecord?.value || null);
    if (!activeCheckpoint?.id) {
      await completion;
      return;
    }

    const [activeSnapshot, keys] = await Promise.all([
      requestToPromise(snapshots.get(activeCheckpoint.id)),
      requestToPromise(snapshots.getAllKeys())
    ]);
    const keep = new Set([
      activeCheckpoint.id,
      activeSnapshot?.parentCheckpointId,
      SHARED_SNAPSHOT_ID,
      DEVICE_SNAPSHOT_ID,
      LEGACY_SNAPSHOT_ID
    ].filter(Boolean));
    for (const key of keys) {
      if (String(key).startsWith("shared-checkpoint-") && !keep.has(key)) {
        snapshots.delete(key);
      }
    }
    await completion;
  }

  async replaceSyncState(sharedSnapshot, operations) {
    const db = await this.open();
    const transaction = db.transaction(["snapshots", "operations", "meta"], "readwrite");
    const completion = transactionToPromise(transaction);
    const snapshots = transaction.objectStore("snapshots");
    const operationStore = transaction.objectStore("operations");
    const meta = transaction.objectStore("meta");
    const [activeRecord, headRecord] = await Promise.all([
      requestToPromise(meta.get(ACTIVE_CHECKPOINT_META_KEY)),
      requestToPromise(meta.get(SHARED_HEAD_META_KEY))
    ]);

    const previous = cloneValue(activeRecord?.value || null);
    const checkpoint = createCheckpoint(previous);
    const previousHead = cloneValue(headRecord?.value || emptyHead(previous));
    const persistedOperations = cloneValue(operations || []);
    const checkpointMetadata = {
      checkpointVersion: checkpoint.version,
      parentCheckpointId: previous?.id || null,
      parentCheckpointVersion: previous?.version || 0
    };
    const checkpointRecord = snapshotRecord(checkpoint.id, sharedSnapshot, checkpointMetadata);
    const head = {
      revision: (previousHead.revision || 0) + 1,
      operationCount: persistedOperations.length,
      operationBytes: operationLogBytes(persistedOperations),
      checkpointId: checkpoint.id,
      checkpointVersion: checkpoint.version,
      updatedAt: Date.now()
    };

    snapshots.put(checkpointRecord);
    operationStore.clear();
    for (const operation of persistedOperations) {
      operationStore.put(operationRecord(operation, {
        revision: head.revision,
        parentCheckpointId: checkpoint.id,
        parentCheckpointVersion: checkpoint.version,
        byteLength: jsonBytes(operation)
      }));
    }
    meta.put({ key: ACTIVE_CHECKPOINT_META_KEY, value: checkpoint });
    meta.put({ key: SHARED_HEAD_META_KEY, value: head });
    meta.put({ key: "syncSchemaVersion", value: SYNC_SCHEMA_VERSION });
    meta.put({ key: "sharedSavedAt", value: Date.now() });
    await completion;

    return {
      checkpoint,
      previousCheckpoint: previous,
      logicalBytesWritten: jsonBytes(checkpointRecord) + jsonBytes(head) + head.operationBytes
    };
  }

  async clear() {
    const db = await this.open();
    const transaction = db.transaction(
      ["snapshots", "transactions", "operations", "devicePatches", "meta"],
      "readwrite"
    );
    transaction.objectStore("snapshots").clear();
    transaction.objectStore("transactions").clear();
    transaction.objectStore("operations").clear();
    transaction.objectStore("devicePatches").clear();
    transaction.objectStore("meta").clear();
    await transactionToPromise(transaction);
  }
}

export function createIndexedDbSyncStore(options = {}) {
  return new IndexedDbSyncStore(options);
}
