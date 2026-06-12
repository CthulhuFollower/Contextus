import {
  cloneValue,
  createEmptyDeviceSnapshot,
  createEmptySharedSnapshot,
  createSyncId,
  migrateLegacyWorkspace,
  validateMigratedWorkspace
} from "./workspace-model.js";
import {
  SHARED_OPERATION_TYPES,
  applyOperationMutable,
  mergeSharedSnapshots,
  sortOperations
} from "./merge-engine.js";
import {
  applyDevicePatchMutable,
  coalesceDevicePatches,
  getDevicePatchKey,
  normalizeDevicePatch,
  replayDevicePatches,
  sortDevicePatches
} from "./device-patches.js";
import {
  measureStartupAsync,
  measureStartupSync
} from "../runtime/startup-profiler.js";

const MAX_OPERATION_COUNT = 500;
const MAX_OPERATION_BYTES = 5 * 1024 * 1024;

function nextClock(previous, now, deviceId) {
  const wallTime = Math.max(Number(now) || Date.now(), previous?.wallTime || 0);
  return {
    wallTime,
    counter: wallTime === previous?.wallTime ? (previous.counter || 0) + 1 : 0,
    deviceId
  };
}

function operationBytes(operation) {
  return JSON.stringify(operation).length;
}

function operationsBytes(operations) {
  return operations.reduce((total, operation) => total + operationBytes(operation), 0);
}

function privatePatchesBytes(patches) {
  return patches.reduce((total, patch) => total + operationBytes(patch), 0);
}

export class MemorySyncStore {
  constructor(seed = {}) {
    this.sharedSnapshot = cloneValue(seed.sharedSnapshot || null);
    this.deviceSnapshot = cloneValue(seed.deviceSnapshot || null);
    this.operations = cloneValue(seed.operations || []);
    const historicalPrivatePatches = sortDevicePatches(cloneValue(seed.devicePatches || []));
    this.devicePatches = coalesceDevicePatches(historicalPrivatePatches);
    this.legacySnapshot = cloneValue(seed.legacySnapshot || null);
    this.checkpoints = new Map();
    this.operationMetadata = new Map();
    this.activeCheckpoint = this.sharedSnapshot
      ? { id: "memory-checkpoint-1", version: 1 }
      : null;
    this.previousCheckpoint = null;
    this.persistenceHead = {
      revision: this.operations.length,
      operationCount: this.operations.length,
      operationBytes: operationsBytes(this.operations),
      checkpointId: this.activeCheckpoint?.id || null,
      checkpointVersion: this.activeCheckpoint?.version || 0
    };
    this.privatePersistenceHead = {
      revision: Math.max(
        Number(seed.privatePersistence?.revision) || 0,
        Number(historicalPrivatePatches.at(-1)?.revision) || 0
      ),
      patchCount: this.devicePatches.length,
      patchBytes: privatePatchesBytes(this.devicePatches)
    };
    if (this.sharedSnapshot) {
      this.checkpoints.set(this.activeCheckpoint.id, cloneValue(this.sharedSnapshot));
    }
  }

  async load() {
    return {
      sharedSnapshot: cloneValue(this.sharedSnapshot),
      deviceSnapshot: cloneValue(this.deviceSnapshot),
      operations: cloneValue(this.operations),
      devicePatches: cloneValue(this.devicePatches),
      legacySnapshot: cloneValue(this.legacySnapshot),
      persistence: {
        ...cloneValue(this.persistenceHead),
        activeCheckpoint: cloneValue(this.activeCheckpoint)
      },
      privatePersistence: cloneValue(this.privatePersistenceHead)
    };
  }

  async writeMigration({ sharedSnapshot, deviceSnapshot }) {
    this.sharedSnapshot = cloneValue(sharedSnapshot);
    this.deviceSnapshot = cloneValue(deviceSnapshot);
    this.operations = [];
    this.devicePatches = [];
    this.operationMetadata.clear();
    this.activeCheckpoint = { id: "memory-checkpoint-1", version: 1 };
    this.previousCheckpoint = null;
    this.checkpoints.set(this.activeCheckpoint.id, cloneValue(sharedSnapshot));
    this.persistenceHead = {
      revision: 0,
      operationCount: 0,
      operationBytes: 0,
      checkpointId: this.activeCheckpoint.id,
      checkpointVersion: this.activeCheckpoint.version
    };
    this.privatePersistenceHead = { revision: 0, patchCount: 0, patchBytes: 0 };
  }

  async commitShared(sharedSnapshot, operation) {
    const persistedOperation = cloneValue(operation);
    const bytes = operationBytes(persistedOperation);
    const revision = (this.persistenceHead.revision || 0) + 1;
    const metadata = {
      revision,
      deviceId: operation.deviceId,
      sequence: operation.sequence,
      parentCheckpointId: this.activeCheckpoint?.id || null,
      parentCheckpointVersion: this.activeCheckpoint?.version || 0,
      byteLength: bytes
    };
    this.operations.push(persistedOperation);
    this.operationMetadata.set(operation.operationId, metadata);
    this.persistenceHead = {
      ...this.persistenceHead,
      revision,
      deviceId: operation.deviceId,
      sequence: operation.sequence,
      operationCount: this.operations.length,
      operationBytes: (this.persistenceHead.operationBytes || 0) + bytes
    };
    return {
      logicalBytesWritten: bytes + operationBytes(this.persistenceHead),
      metadata: cloneValue(metadata)
    };
  }

  async saveDevice(deviceSnapshot) {
    this.deviceSnapshot = cloneValue(deviceSnapshot);
    this.devicePatches = [];
    this.privatePersistenceHead = { revision: 0, patchCount: 0, patchBytes: 0 };
  }

  async commitDevicePatches(patches) {
    let revision = this.privatePersistenceHead.revision || 0;
    const metadata = [];
    let patchBytes = this.privatePersistenceHead.patchBytes || 0;
    const byKey = new Map(this.devicePatches.map(patch => [getDevicePatchKey(patch), patch]));
    for (const patch of patches || []) {
      revision += 1;
      const persisted = cloneValue(patch);
      const patchKey = getDevicePatchKey(persisted);
      persisted.patchKey = patchKey;
      persisted.revision = revision;
      const byteLength = operationBytes(persisted);
      const previous = byKey.get(patchKey);
      const replacedByteLength = previous ? operationBytes(previous) : 0;
      patchBytes += byteLength - replacedByteLength;
      byKey.set(patchKey, persisted);
      metadata.push({
        patchId: persisted.patchId,
        patchKey,
        revision,
        byteLength,
        replacedByteLength
      });
    }
    this.devicePatches = sortDevicePatches([...byKey.values()]);
    this.privatePersistenceHead = {
      revision,
      patchCount: this.devicePatches.length,
      patchBytes
    };
    return {
      metadata,
      head: cloneValue(this.privatePersistenceHead),
      logicalBytesWritten:
        metadata.reduce((total, item) => total + item.byteLength, 0) +
        operationBytes(this.privatePersistenceHead)
    };
  }

  async publishCheckpoint(sharedSnapshot) {
    const previous = this.activeCheckpoint;
    const version = (previous?.version || 0) + 1;
    const checkpoint = { id: `memory-checkpoint-${version}`, version };
    const persistedSnapshot = cloneValue(sharedSnapshot);
    this.checkpoints.set(checkpoint.id, persistedSnapshot);
    this.sharedSnapshot = persistedSnapshot;
    this.previousCheckpoint = previous;
    this.activeCheckpoint = checkpoint;
    this.persistenceHead = {
      ...this.persistenceHead,
      revision: (this.persistenceHead.revision || 0) + 1,
      checkpointId: checkpoint.id,
      checkpointVersion: checkpoint.version
    };
    return {
      checkpoint: cloneValue(checkpoint),
      previousCheckpoint: cloneValue(previous),
      logicalBytesWritten: operationBytes(persistedSnapshot)
    };
  }

  async pruneOperations(operations = []) {
    this.operations = cloneValue(operations);
    this.operationMetadata.clear();
    this.persistenceHead = {
      ...this.persistenceHead,
      revision: (this.persistenceHead.revision || 0) + 1,
      operationCount: this.operations.length,
      operationBytes: operationsBytes(this.operations)
    };
  }

  async pruneCheckpoints() {
    const keep = new Set([
      this.activeCheckpoint?.id,
      this.previousCheckpoint?.id
    ].filter(Boolean));
    for (const checkpointId of this.checkpoints.keys()) {
      if (!keep.has(checkpointId)) this.checkpoints.delete(checkpointId);
    }
  }

  async replaceSyncState(sharedSnapshot, operations) {
    const persistedSnapshot = cloneValue(sharedSnapshot);
    const persistedOperations = cloneValue(operations || []);
    const previous = this.activeCheckpoint;
    const version = (previous?.version || 0) + 1;
    const checkpoint = { id: `memory-checkpoint-${version}`, version };
    this.checkpoints.set(checkpoint.id, persistedSnapshot);
    this.sharedSnapshot = persistedSnapshot;
    this.operations = persistedOperations;
    this.operationMetadata.clear();
    this.previousCheckpoint = previous;
    this.activeCheckpoint = checkpoint;
    this.persistenceHead = {
      revision: (this.persistenceHead.revision || 0) + 1,
      operationCount: persistedOperations.length,
      operationBytes: operationsBytes(persistedOperations),
      checkpointId: checkpoint.id,
      checkpointVersion: checkpoint.version
    };
  }

  async clear() {
    this.sharedSnapshot = null;
    this.deviceSnapshot = null;
    this.operations = [];
    this.devicePatches = [];
    this.legacySnapshot = null;
    this.checkpoints.clear();
    this.operationMetadata.clear();
    this.activeCheckpoint = null;
    this.previousCheckpoint = null;
    this.persistenceHead = {
      revision: 0,
      operationCount: 0,
      operationBytes: 0,
      checkpointId: null,
      checkpointVersion: 0
    };
    this.privatePersistenceHead = { revision: 0, patchCount: 0, patchBytes: 0 };
  }
}

export class LocalSyncEngine {
  constructor(options = {}) {
    this.store = options.store || new MemorySyncStore();
    this.now = options.now || (() => Date.now());
    this.idFactory = options.idFactory || createSyncId;
    this.profiler = options.profiler || null;
    this.sharedSnapshot = null;
    this.deviceSnapshot = null;
    this.operations = [];
    this.devicePatches = [];
    this.operationLogBytes = 0;
    this.privatePatchLogBytes = 0;
    this.privateRevision = 0;
    this.lastClock = null;
    this.persistenceChain = Promise.resolve();
  }

  queuePersistence(task) {
    const queued = this.persistenceChain.then(task, task);
    this.persistenceChain = queued.catch(() => {});
    return queued;
  }

  async initialize(options = {}) {
    const endInitialize = this.profiler?.start?.("engine.initialize.total");
    try {
      const loaded = await measureStartupAsync(this.profiler, "engine.storeLoad", () => this.store.load());
      measureStartupSync(this.profiler, "engine.prepareLogs", () => {
        this.operations = sortOperations(loaded.operations || []);
        this.operationLogBytes = loaded.persistence?.operationBytes ?? operationsBytes(this.operations);
        this.devicePatches = coalesceDevicePatches(loaded.devicePatches || []);
        this.privatePatchLogBytes =
          loaded.privatePersistence?.patchBytes ?? privatePatchesBytes(this.devicePatches);
        this.privateRevision = loaded.privatePersistence?.revision
          ?? this.devicePatches.at(-1)?.revision
          ?? 0;
      });

      if (loaded.sharedSnapshot) {
        this.sharedSnapshot = measureStartupSync(
          this.profiler,
          "engine.cloneShared",
          () => cloneValue(loaded.sharedSnapshot)
        );
        measureStartupSync(this.profiler, "engine.replayShared", () => {
          for (const operation of this.operations) {
            applyOperationMutable(this.sharedSnapshot, operation);
          }
        }, { operationCount: this.operations.length });
        this.deviceSnapshot = measureStartupSync(
          this.profiler,
          "engine.cloneDevice",
          () => loaded.deviceSnapshot
            ? cloneValue(loaded.deviceSnapshot)
            : createEmptyDeviceSnapshot(this.sharedSnapshot.workspaceId)
        );
        measureStartupSync(
          this.profiler,
          "engine.replayPrivate",
          () => replayDevicePatches(this.deviceSnapshot, this.devicePatches),
          { patchCount: this.devicePatches.length }
        );
        if (!loaded.persistence?.activeCheckpoint && typeof this.store.ensureCheckpoint === "function") {
          await measureStartupAsync(
            this.profiler,
            "engine.ensureCheckpoint",
            () => this.queuePersistence(() => this.store.ensureCheckpoint(this.sharedSnapshot, this.operations))
          );
        }
        return measureStartupSync(this.profiler, "engine.getStateClone", () => this.getState());
      }

      const legacyState = loaded.legacySnapshot?.state || options.legacyState || null;
      if (!legacyState) {
        return measureStartupSync(this.profiler, "engine.getStateClone", () => this.getState());
      }

      try {
        const migrated = measureStartupSync(this.profiler, "engine.migrateLegacy", () => {
          const value = migrateLegacyWorkspace(legacyState, {
            workspaceId: options.workspaceId,
            deviceId: options.deviceId
          });
          validateMigratedWorkspace(legacyState, value);
          return value;
        });
        this.sharedSnapshot = migrated.sharedSnapshot;
        this.deviceSnapshot = migrated.deviceSnapshot;
        this.devicePatches = [];
        this.privatePatchLogBytes = 0;
        this.privateRevision = 0;
        await measureStartupAsync(this.profiler, "engine.writeMigration", () => this.store.writeMigration(migrated));
        return measureStartupSync(this.profiler, "engine.getStateClone", () => this.getState());
      } catch (error) {
        error.code = error.code || "SYNC_MIGRATION_FAILED";
        throw error;
      }
    } finally {
      endInitialize?.();
    }
  }

  async adoptWorkspaceState(workspaceState, options = {}) {
    if (this.sharedSnapshot) return this.getState();
    const migrated = migrateLegacyWorkspace(workspaceState, options);
    validateMigratedWorkspace(workspaceState, migrated);
    this.sharedSnapshot = migrated.sharedSnapshot;
    this.deviceSnapshot = migrated.deviceSnapshot;
    this.operations = [];
    this.devicePatches = [];
    this.operationLogBytes = 0;
    this.privatePatchLogBytes = 0;
    this.privateRevision = 0;
    await this.store.writeMigration(migrated);
    return this.getState();
  }

  getState() {
    return {
      sharedSnapshot: cloneValue(this.sharedSnapshot),
      deviceSnapshot: cloneValue(this.deviceSnapshot),
      operations: cloneValue(this.operations)
    };
  }

  getManifest() {
    if (!this.sharedSnapshot) return null;
    return {
      workspaceId: this.sharedSnapshot.workspaceId,
      vector: cloneValue(this.sharedSnapshot.vector || {}),
      compactedVector: cloneValue(this.sharedSnapshot.compactedVector || {})
    };
  }

  async recordSharedChange(type, target = {}, payload = {}) {
    if (!SHARED_OPERATION_TYPES.has(type)) {
      throw new Error(`Tipo de operacion compartida desconocido: ${type}`);
    }
    if (!this.sharedSnapshot || !this.deviceSnapshot) {
      throw new Error("El motor de sincronizacion no esta inicializado.");
    }

    const deviceId = this.deviceSnapshot.deviceId;
    const context = cloneValue(this.sharedSnapshot.vector || {});
    const sequence = (context[deviceId] || 0) + 1;
    this.lastClock = nextClock(this.lastClock, this.now(), deviceId);

    const operation = {
      operationId: this.idFactory("operation"),
      workspaceId: this.sharedSnapshot.workspaceId,
      deviceId,
      sequence,
      context,
      clock: cloneValue(this.lastClock),
      type,
      target: cloneValue(target),
      payload: cloneValue(payload)
    };

    applyOperationMutable(this.sharedSnapshot, operation);
    this.operations.push(operation);
    this.operationLogBytes += operationBytes(operation);
    await this.queuePersistence(() => this.store.commitShared(this.sharedSnapshot, operation));

    if (this.shouldCompact()) await this.compact();
    return { operation: cloneValue(operation) };
  }

  async saveDeviceState(deviceState) {
    if (!this.sharedSnapshot) {
      throw new Error("No existe un universo inicializado.");
    }
    this.deviceSnapshot = cloneValue(deviceState);
    this.deviceSnapshot.workspaceId = this.sharedSnapshot.workspaceId;
    this.deviceSnapshot.savedAt = this.now();
    await this.queuePersistence(() => this.store.saveDevice(this.deviceSnapshot));
    this.devicePatches = [];
    this.privatePatchLogBytes = 0;
    this.privateRevision = 0;
    return cloneValue(this.deviceSnapshot);
  }

  async recordDevicePatches(patches) {
    if (!this.sharedSnapshot || !this.deviceSnapshot) {
      throw new Error("El motor de sincronizacion no esta inicializado.");
    }
    if (!Array.isArray(patches) || !patches.length) {
      return { patches: [] };
    }

    const prepared = patches.map(patch => ({
      ...normalizeDevicePatch(patch),
      patchKey: getDevicePatchKey(patch),
      patchId: this.idFactory("device-patch"),
      workspaceId: this.sharedSnapshot.workspaceId,
      deviceId: this.deviceSnapshot.deviceId,
      createdAt: this.now()
    }));
    for (const patch of prepared) {
      applyDevicePatchMutable(this.deviceSnapshot, patch);
    }
    const result = await this.queuePersistence(() => this.store.commitDevicePatches(prepared));
    const revisionById = new Map(
      (result?.metadata || []).map(item => [item.patchId, item.revision])
    );

    const byKey = new Map(this.devicePatches.map(patch => [getDevicePatchKey(patch), patch]));
    for (const patch of prepared) {
      patch.revision = revisionById.get(patch.patchId) || ++this.privateRevision;
      this.privateRevision = Math.max(this.privateRevision, patch.revision);
      byKey.set(getDevicePatchKey(patch), cloneValue(patch));
    }
    this.devicePatches = sortDevicePatches([...byKey.values()]);
    this.privatePatchLogBytes =
      result?.head?.patchBytes ?? privatePatchesBytes(this.devicePatches);
    this.privateRevision = Math.max(
      this.privateRevision,
      Number(result?.head?.revision) || 0
    );
    return { patches: cloneValue(prepared), persistence: cloneValue(result) };
  }

  exportBundle(peerManifest = null) {
    if (!this.sharedSnapshot) return null;
    const peerVector = peerManifest?.vector || {};
    const peerWorkspaceId = peerManifest?.workspaceId || null;
    const requiresSnapshot =
      peerWorkspaceId !== this.sharedSnapshot.workspaceId ||
      Object.entries(this.sharedSnapshot.compactedVector || {})
        .some(([deviceId, sequence]) => (peerVector[deviceId] || 0) < sequence);

    return {
      schemaVersion: 1,
      workspaceId: this.sharedSnapshot.workspaceId,
      manifest: this.getManifest(),
      sharedSnapshot: requiresSnapshot ? cloneValue(this.sharedSnapshot) : null,
      operations: cloneValue(
        this.operations.filter(operation => operation.sequence > (peerVector[operation.deviceId] || 0))
      )
    };
  }

  async importBundle(bundle) {
    if (!bundle?.workspaceId) throw new Error("Bundle de sincronizacion invalido.");

    const createdLocalDevice = !this.sharedSnapshot;
    if (!this.sharedSnapshot) {
      this.sharedSnapshot = bundle.sharedSnapshot
        ? cloneValue(bundle.sharedSnapshot)
        : createEmptySharedSnapshot(bundle.workspaceId);
      this.deviceSnapshot = createEmptyDeviceSnapshot(bundle.workspaceId);
    }

    if (this.sharedSnapshot.workspaceId !== bundle.workspaceId) {
      throw new Error("El bundle pertenece a otro universo.");
    }

    if (bundle.sharedSnapshot) {
      this.sharedSnapshot = mergeSharedSnapshots(this.sharedSnapshot, bundle.sharedSnapshot);
    }

    const knownOperations = new Set(this.operations.map(operation => operation.operationId));
    for (const operation of sortOperations(bundle.operations || [])) {
      applyOperationMutable(this.sharedSnapshot, operation);
      if (!knownOperations.has(operation.operationId)) {
        this.operations.push(cloneValue(operation));
        this.operationLogBytes += operationBytes(operation);
        knownOperations.add(operation.operationId);
      }
    }

    await this.queuePersistence(() => this.store.replaceSyncState(this.sharedSnapshot, this.operations));
    if (typeof this.store.pruneCheckpoints === "function") {
      await this.queuePersistence(() => this.store.pruneCheckpoints());
    }
    if (createdLocalDevice) {
      await this.queuePersistence(() => this.store.saveDevice(this.deviceSnapshot));
    }
    if (this.shouldCompact()) await this.compact();
    return this.getState();
  }

  shouldCompact() {
    return this.operations.length >= MAX_OPERATION_COUNT || this.operationLogBytes >= MAX_OPERATION_BYTES;
  }

  async compact() {
    if (!this.sharedSnapshot) return null;
    const checkpointSnapshot = cloneValue(this.sharedSnapshot);
    checkpointSnapshot.compactedVector = cloneValue(checkpointSnapshot.vector || {});
    checkpointSnapshot.savedAt = this.now();

    if (typeof this.store.publishCheckpoint === "function") {
      await this.queuePersistence(() => this.store.publishCheckpoint(checkpointSnapshot));
      this.sharedSnapshot = checkpointSnapshot;
      await this.queuePersistence(() => this.store.pruneOperations([]));
      if (typeof this.store.pruneCheckpoints === "function") {
        await this.queuePersistence(() => this.store.pruneCheckpoints());
      }
    } else {
      await this.queuePersistence(() => this.store.replaceSyncState(checkpointSnapshot, []));
      this.sharedSnapshot = checkpointSnapshot;
    }
    this.operations = [];
    this.operationLogBytes = 0;
    return cloneValue(this.sharedSnapshot);
  }

  getConflicts() {
    return cloneValue(this.sharedSnapshot?.conflicts || []);
  }

  async resolveFieldConflict(conflictId, value) {
    const conflict = this.sharedSnapshot?.conflicts?.find(item => item.id === conflictId);
    if (!conflict) throw new Error("El conflicto ya no existe.");
    return this.recordSharedChange(
      "conflict.resolve",
      { kind: conflict.kind, syncId: conflict.targetSyncId, mapSyncId: conflict.mapSyncId },
      { conflictId, value }
    );
  }

  getRecoveries() {
    return cloneValue(this.sharedSnapshot?.recoveries || []);
  }
}
