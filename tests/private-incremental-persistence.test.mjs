import assert from "node:assert/strict";
import test from "node:test";

import { LocalSyncEngine, MemorySyncStore } from "../sync/local-sync-engine.js";
import { filterChangedDevicePatches } from "../sync/device-patches.js";
import { migrateLegacyWorkspace } from "../sync/workspace-model.js";

function seed() {
  return migrateLegacyWorkspace({
    version: 7,
    activeMapId: 1,
    mapIdCounter: 1,
    mapsView: { x: 0, y: 0, targetX: 0, targetY: 0, zoom: 1, targetZoom: 1 },
    maps: [{
      id: 1,
      nodeIdCounter: 2,
      selectedNodeId: 1,
      constellationPosition: { x: 0, y: 0 },
      camera: { x: 0, y: 0, targetX: 0, targetY: 0, zoom: 1, targetZoom: 1 },
      nodes: [
        { id: 1, parentId: null, level: 0, isCenter: true, label: "Centro", note: "", x: 0, y: 0 },
        { id: 2, parentId: 1, level: 1, isCenter: false, label: "Idea", note: "", x: 100, y: 0 }
      ],
      links: [{ from: 1, to: 2 }]
    }]
  }, {
    workspaceId: "workspace_private_incremental",
    deviceId: "device_private_incremental"
  });
}

async function createEngine(store) {
  const engine = new LocalSyncEngine({
    store,
    now: () => 10_000,
    idFactory: (() => {
      let sequence = 0;
      return prefix => `${prefix}-${++sequence}`;
    })()
  });
  await engine.initialize();
  return engine;
}

class FailingPrivatePatchStore extends MemorySyncStore {
  async commitDevicePatches() {
    throw new Error("simulated private transaction interruption");
  }
}

class ToggleFailingPrivatePatchStore extends MemorySyncStore {
  failPrivateCommit = false;

  async commitDevicePatches(patches) {
    if (this.failPrivateCommit) {
      throw new Error("simulated coalesced replacement interruption");
    }
    return super.commitDevicePatches(patches);
  }
}

class DelayedPrivatePatchStore extends MemorySyncStore {
  async commitDevicePatches(patches) {
    await new Promise(resolve => setTimeout(resolve, 10));
    return super.commitDevicePatches(patches);
  }
}

test("private patches persist revision and patch atomically without changing device-current", async () => {
  const migrated = seed();
  const store = new MemorySyncStore(migrated);
  const checkpointBefore = structuredClone(store.deviceSnapshot);
  const engine = await createEngine(store);
  const mapSyncId = engine.deviceSnapshot.activeMapSyncId;

  await engine.recordDevicePatches([
    {
      type: "setSelectedNode",
      mapSyncId,
      selectedNodeSyncId: null
    },
    {
      type: "setMapCamera",
      mapSyncId,
      camera: { x: 10, y: 20, zoom: 2 }
    }
  ]);

  assert.deepEqual(store.deviceSnapshot, checkpointBefore);
  assert.equal(store.devicePatches.length, 2);
  assert.deepEqual(store.devicePatches.map(patch => patch.revision), [1, 2]);
  assert.equal(store.privatePersistenceHead.revision, 2);
  assert.equal(store.privatePersistenceHead.patchCount, 2);

  const restarted = await createEngine(store);
  assert.deepEqual(restarted.deviceSnapshot, engine.deviceSnapshot);
});

test("failed private patch transaction leaves durable checkpoint and log unchanged", async () => {
  const store = new FailingPrivatePatchStore(seed());
  const engine = await createEngine(store);
  const before = structuredClone(engine.deviceSnapshot);

  await assert.rejects(() => engine.recordDevicePatches([
    { type: "setActiveMap", activeMapSyncId: "map-other" }
  ]), /private transaction interruption/);

  assert.equal(engine.deviceSnapshot.activeMapSyncId, "map-other");
  assert.deepEqual(store.deviceSnapshot, before);
  assert.equal(store.devicePatches.length, 0);
  assert.equal(store.privatePersistenceHead.revision, 0);
  const restarted = await createEngine(store);
  assert.deepEqual(restarted.deviceSnapshot, before);
});

test("full private save establishes a new checkpoint and clears represented patches", async () => {
  const store = new MemorySyncStore(seed());
  const engine = await createEngine(store);
  const mapSyncId = engine.deviceSnapshot.activeMapSyncId;
  await engine.recordDevicePatches([
    {
      type: "setMapCamera",
      mapSyncId,
      camera: { x: 10, y: 20, zoom: 2 }
    }
  ]);

  const finalDevice = structuredClone(engine.deviceSnapshot);
  await engine.saveDeviceState(finalDevice);

  assert.deepEqual(store.deviceSnapshot, finalDevice);
  assert.equal(store.devicePatches.length, 0);
  assert.equal(store.privatePersistenceHead.revision, 0);
  const restarted = await createEngine(store);
  assert.deepEqual(restarted.deviceSnapshot, finalDevice);
});

test("pending private persistence exposes the latest state to subsequent interactions", async () => {
  const store = new DelayedPrivatePatchStore(seed());
  const engine = await createEngine(store);
  const mapSyncId = engine.deviceSnapshot.activeMapSyncId;
  const initialCamera = structuredClone(engine.deviceSnapshot.mapStates[mapSyncId].camera);
  const pending = engine.recordDevicePatches([{
    type: "setMapCamera",
    mapSyncId,
    camera: { x: 10, y: 20, zoom: 2 }
  }]);

  assert.equal(engine.deviceSnapshot.mapStates[mapSyncId].camera.x, 10);
  const reversal = filterChangedDevicePatches(engine.deviceSnapshot, [{
    type: "setMapCamera",
    mapSyncId,
    camera: initialCamera
  }]);
  assert.equal(reversal.length, 1);
  await pending;
});

test("one thousand camera and selection interactions remain coalesced and replay exactly", async () => {
  const store = new MemorySyncStore(seed());
  const engine = await createEngine(store);
  const mapSyncId = engine.deviceSnapshot.activeMapSyncId;
  const nodeSyncId = Object.keys(engine.deviceSnapshot.nodeAliases[mapSyncId])[1];

  for (let index = 1; index <= 1_000; index += 1) {
    await engine.recordDevicePatches([
      {
        type: "setMapCamera",
        mapSyncId,
        camera: { x: index, y: -index, zoom: 1 + index / 1_000 }
      },
      {
        type: "setSelectedNode",
        mapSyncId,
        selectedNodeSyncId: index % 2 ? nodeSyncId : null
      }
    ]);
  }

  assert.equal(store.devicePatches.length, 2);
  assert.equal(store.privatePersistenceHead.revision, 2_000);
  assert.equal(store.privatePersistenceHead.patchCount, 2);
  assert.equal(
    store.privatePersistenceHead.patchBytes,
    store.devicePatches.reduce((total, patch) => total + JSON.stringify(patch).length, 0)
  );
  const checkpointBefore = structuredClone(store.deviceSnapshot);
  const restarted = await createEngine(store);
  assert.deepEqual(store.deviceSnapshot, checkpointBefore);
  assert.deepEqual(restarted.deviceSnapshot, engine.deviceSnapshot);
  assert.deepEqual(restarted.deviceSnapshot.mapStates[mapSyncId].camera, {
    x: 1_000,
    y: -1_000,
    targetX: 1_000,
    targetY: -1_000,
    zoom: 2,
    targetZoom: 2
  });
  assert.equal(restarted.deviceSnapshot.mapStates[mapSyncId].selectedNodeSyncId, null);
});

test("camera patches coalesce independently for multiple maps", async () => {
  const store = new MemorySyncStore(seed());
  const engine = await createEngine(store);
  for (const [index, mapSyncId] of ["map-a", "map-b", "map-c"].entries()) {
    await engine.recordDevicePatches([{
      type: "setMapCamera",
      mapSyncId,
      camera: { x: index + 1, y: -(index + 1), zoom: index + 1 }
    }]);
  }
  await engine.recordDevicePatches([{
    type: "setMapCamera",
    mapSyncId: "map-a",
    camera: { x: 99, y: -99, zoom: 4 }
  }]);

  assert.equal(store.devicePatches.length, 3);
  assert.equal(store.privatePersistenceHead.patchCount, 3);
  assert.equal(
    store.devicePatches.find(patch => patch.patchKey === "mapCamera:map-a").camera.x,
    99
  );
});

test("camera and selection for the same map never replace each other", async () => {
  const store = new MemorySyncStore(seed());
  const engine = await createEngine(store);
  const mapSyncId = engine.deviceSnapshot.activeMapSyncId;

  await engine.recordDevicePatches([
    {
      type: "setMapCamera",
      mapSyncId,
      camera: { x: 12, y: -5, zoom: 2 }
    },
    {
      type: "setSelectedNode",
      mapSyncId,
      selectedNodeSyncId: null
    }
  ]);
  await engine.recordDevicePatches([{
    type: "setMapCamera",
    mapSyncId,
    camera: { x: 18, y: -7, zoom: 3 }
  }]);

  assert.deepEqual(
    store.devicePatches.map(patch => patch.patchKey).sort(),
    [`mapCamera:${mapSyncId}`, `selectedNode:${mapSyncId}`].sort()
  );
  const restarted = await createEngine(store);
  assert.equal(restarted.deviceSnapshot.mapStates[mapSyncId].camera.x, 18);
  assert.equal(restarted.deviceSnapshot.mapStates[mapSyncId].selectedNodeSyncId, null);
});

test("failed coalesced replacement preserves the previous durable patch", async () => {
  const store = new ToggleFailingPrivatePatchStore(seed());
  const engine = await createEngine(store);
  const mapSyncId = engine.deviceSnapshot.activeMapSyncId;
  await engine.recordDevicePatches([{
    type: "setMapCamera",
    mapSyncId,
    camera: { x: 10, y: -10, zoom: 2 }
  }]);
  const durableBefore = structuredClone(store.devicePatches);
  const headBefore = structuredClone(store.privatePersistenceHead);
  store.failPrivateCommit = true;

  await assert.rejects(() => engine.recordDevicePatches([{
    type: "setMapCamera",
    mapSyncId,
    camera: { x: 20, y: -20, zoom: 3 }
  }]), /coalesced replacement interruption/);

  assert.deepEqual(store.devicePatches, durableBefore);
  assert.deepEqual(store.privatePersistenceHead, headBefore);
  const restarted = await createEngine(store);
  assert.equal(restarted.deviceSnapshot.mapStates[mapSyncId].camera.x, 10);
});

test("historical append-only private patches migrate to coalesced memory state", async () => {
  const migrated = seed();
  const mapSyncId = migrated.deviceSnapshot.activeMapSyncId;
  const store = new MemorySyncStore({
    ...migrated,
    privatePersistence: { revision: 4 },
    devicePatches: [
      {
        patchId: "camera-1",
        revision: 1,
        type: "setMapCamera",
        mapSyncId,
        camera: { x: 1, y: -1, zoom: 1 }
      },
      {
        patchId: "selected-1",
        revision: 2,
        type: "setSelectedNode",
        mapSyncId,
        selectedNodeSyncId: null
      },
      {
        patchId: "camera-2",
        revision: 3,
        type: "setMapCamera",
        mapSyncId,
        camera: { x: 3, y: -3, zoom: 2 }
      },
      {
        patchId: "camera-3",
        revision: 4,
        type: "setMapCamera",
        mapSyncId,
        camera: { x: 4, y: -4, zoom: 3 }
      }
    ]
  });

  assert.equal(store.devicePatches.length, 2);
  assert.equal(store.privatePersistenceHead.patchCount, 2);
  assert.equal(store.privatePersistenceHead.revision, 4);
  const engine = await createEngine(store);
  assert.equal(engine.deviceSnapshot.mapStates[mapSyncId].camera.x, 4);
  assert.equal(engine.deviceSnapshot.mapStates[mapSyncId].selectedNodeSyncId, null);
});
