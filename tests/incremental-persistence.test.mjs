import assert from "node:assert/strict";
import test from "node:test";

import { LocalSyncEngine, MemorySyncStore } from "../sync/local-sync-engine.js";
import { migrateLegacyWorkspace } from "../sync/workspace-model.js";

function legacyWorkspace() {
  return {
    version: 7,
    activeMapId: 1,
    mapIdCounter: 1,
    mapsView: { x: 0, y: 0, targetX: 0, targetY: 0, zoom: 1, targetZoom: 1 },
    maps: [{
      id: 1,
      starType: "yellow",
      nodeIdCounter: 2,
      selectedNodeId: 2,
      constellationPosition: { x: 0, y: 0 },
      camera: { x: 0, y: 0, targetX: 0, targetY: 0, zoom: 1, targetZoom: 1 },
      nodes: [
        { id: 1, parentId: null, level: 0, isCenter: true, label: "Centro", note: "", x: 0, y: 0 },
        { id: 2, parentId: 1, level: 1, isCenter: false, label: "Idea", note: "Base", x: 100, y: 0 }
      ],
      links: [{ from: 1, to: 2 }]
    }]
  };
}

function seed() {
  return migrateLegacyWorkspace(legacyWorkspace(), {
    workspaceId: "workspace_incremental",
    deviceId: "device_incremental"
  });
}

async function createEngine(store) {
  const engine = new LocalSyncEngine({
    store,
    now: () => 10_000,
    idFactory: prefix => `${prefix}_${Math.random().toString(36).slice(2)}`
  });
  await engine.initialize();
  return engine;
}

function targetIds(engine) {
  const map = engine.sharedSnapshot.maps[0];
  return { mapSyncId: map.syncId, nodeSyncId: map.nodes[1].syncId };
}

async function editLabel(engine, label) {
  const { mapSyncId, nodeSyncId } = targetIds(engine);
  return engine.recordSharedChange(
    "node.edit",
    { kind: "node", mapSyncId, syncId: nodeSyncId },
    { changes: { label } }
  );
}

function label(engine) {
  return engine.sharedSnapshot.maps[0].nodes[1].label;
}

class FailingPublishStore extends MemorySyncStore {
  async publishCheckpoint() {
    throw new Error("simulated checkpoint interruption");
  }
}

class FailingPruneStore extends MemorySyncStore {
  constructor(value) {
    super(value);
    this.failPrune = true;
  }

  async pruneOperations(operations) {
    if (this.failPrune) {
      this.failPrune = false;
      throw new Error("simulated cleanup interruption");
    }
    return super.pruneOperations(operations);
  }
}

test("small shared changes persist only the operation and atomic head metadata", async () => {
  const migrated = seed();
  const store = new MemorySyncStore(migrated);
  const checkpointBefore = structuredClone(store.sharedSnapshot);
  const engine = await createEngine(store);

  const result = await editLabel(engine, "Persistencia incremental");

  assert.deepEqual(store.sharedSnapshot, checkpointBefore);
  assert.equal(Object.hasOwn(result, "sharedSnapshot"), false);
  assert.equal(store.operations.length, 1);
  const operation = store.operations[0];
  const metadata = store.operationMetadata.get(operation.operationId);
  assert.equal(metadata.revision, 1);
  assert.equal(metadata.sequence, operation.sequence);
  assert.equal(metadata.parentCheckpointId, "memory-checkpoint-1");
  assert.equal(metadata.parentCheckpointVersion, 1);
  assert.ok(metadata.byteLength < JSON.stringify(engine.sharedSnapshot).length);

  const restarted = await createEngine(store);
  assert.equal(label(restarted), "Persistencia incremental");
  assert.deepEqual(restarted.sharedSnapshot, engine.sharedSnapshot);
});

test("interruption during checkpoint leaves the previous checkpoint recoverable", async () => {
  const store = new FailingPublishStore(seed());
  const engine = await createEngine(store);
  await editLabel(engine, "Antes del checkpoint");
  const stateBeforeCheckpoint = structuredClone(engine.sharedSnapshot);

  await assert.rejects(() => engine.compact(), /checkpoint interruption/);
  assert.equal(store.activeCheckpoint.version, 1);
  assert.equal(store.operations.length, 1);

  const restarted = await createEngine(store);
  assert.deepEqual(restarted.sharedSnapshot, stateBeforeCheckpoint);
});

test("interruption after checkpoint publication safely replays retained operations", async () => {
  const store = new FailingPruneStore(seed());
  const engine = await createEngine(store);
  await editLabel(engine, "Checkpoint publicado");

  await assert.rejects(() => engine.compact(), /cleanup interruption/);
  assert.equal(store.activeCheckpoint.version, 2);
  assert.equal(store.checkpoints.size, 2);
  assert.equal(store.operations.length, 1);

  const restarted = await createEngine(store);
  assert.equal(label(restarted), "Checkpoint publicado");
  assert.deepEqual(restarted.sharedSnapshot, engine.sharedSnapshot);
});

test("operations after a completed checkpoint reconstruct the exact latest state", async () => {
  const store = new MemorySyncStore(seed());
  const engine = await createEngine(store);
  await editLabel(engine, "Incluido en checkpoint");
  await engine.compact();
  await editLabel(engine, "Pendiente despues del checkpoint");

  assert.equal(store.activeCheckpoint.version, 2);
  assert.equal(store.checkpoints.size, 2);
  assert.equal(store.operations.length, 1);

  const restarted = await createEngine(store);
  assert.equal(label(restarted), "Pendiente despues del checkpoint");
  assert.deepEqual(restarted.sharedSnapshot, engine.sharedSnapshot);
});

test("checkpoint cleanup retains only the active and immediately previous checkpoints", async () => {
  const store = new MemorySyncStore(seed());
  const engine = await createEngine(store);

  for (const value of ["Uno", "Dos", "Tres"]) {
    await editLabel(engine, value);
    await engine.compact();
  }

  assert.equal(store.checkpoints.size, 2);
  assert.ok(store.checkpoints.has(store.activeCheckpoint.id));
  assert.ok(store.checkpoints.has(store.previousCheckpoint.id));
});
