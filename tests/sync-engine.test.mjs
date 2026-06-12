import assert from "node:assert/strict";
import test from "node:test";

import {
  LocalSyncEngine,
  MemorySyncStore
} from "../sync/local-sync-engine.js";
import {
  captureDeviceSnapshot,
  createEmptyDeviceSnapshot,
  materializeWorkspace,
  migrateLegacyWorkspace
} from "../sync/workspace-model.js";

function legacyWorkspace() {
  return {
    version: 7,
    activeMapId: 1,
    mapIdCounter: 1,
    mapsView: { x: 30, y: 40, targetX: 30, targetY: 40, zoom: 2, targetZoom: 2 },
    maps: [{
      id: 1,
      starType: "yellow",
      starVariant: "default",
      starScale: 1,
      starLuminosity: 1,
      nodeIdCounter: 2,
      selectedNodeId: 2,
      constellationPosition: { x: 12, y: 18 },
      camera: { x: 100, y: 110, targetX: 100, targetY: 110, zoom: 1.5, targetZoom: 1.5 },
      nodes: [
        { id: 1, parentId: null, level: 0, isCenter: true, label: "Centro", note: "", x: 0, y: 0 },
        { id: 2, parentId: 1, level: 1, isCenter: false, label: "Idea", note: "Base", x: 100, y: 0 }
      ],
      links: [{ from: 1, to: 2 }]
    }]
  };
}

function pair() {
  const migrated = migrateLegacyWorkspace(legacyWorkspace(), {
    workspaceId: "workspace_test",
    deviceId: "device_a"
  });
  const deviceB = createEmptyDeviceSnapshot("workspace_test", "device_b");
  return {
    shared: migrated.sharedSnapshot,
    deviceA: migrated.deviceSnapshot,
    deviceB
  };
}

async function engineFrom(sharedSnapshot, deviceSnapshot) {
  const engine = new LocalSyncEngine({
    store: new MemorySyncStore({ sharedSnapshot, deviceSnapshot })
  });
  await engine.initialize();
  return engine;
}

function ids(engine) {
  const map = engine.sharedSnapshot.maps[0];
  return { mapId: map.syncId, nodeId: map.nodes[1].syncId };
}

async function exchange(left, right) {
  await left.importBundle(right.exportBundle(left.getManifest()));
  await right.importBundle(left.exportBundle(right.getManifest()));
}

test("migration separates shared content from private view state", () => {
  const migrated = migrateLegacyWorkspace(legacyWorkspace(), {
    workspaceId: "workspace_test",
    deviceId: "device_a"
  });

  assert.equal(migrated.sharedSnapshot.maps[0].nodes[1].label, "Idea");
  assert.equal(migrated.sharedSnapshot.maps[0].camera, undefined);
  assert.equal(migrated.sharedSnapshot.mapsView, undefined);
  assert.equal(migrated.deviceSnapshot.activeMapSyncId, migrated.sharedSnapshot.maps[0].syncId);
  assert.equal(migrated.deviceSnapshot.mapsView.zoom, 2);

  const materialized = materializeWorkspace(migrated.sharedSnapshot, migrated.deviceSnapshot);
  assert.equal(materialized.state.maps[0].nodes[1].parentId, 1);
  assert.equal(materialized.state.maps[0].camera.zoom, 1.5);
  assert.equal(materialized.state.mapsView.zoom, 2);
});

test("different text fields merge without a conflict", async () => {
  const seed = pair();
  const a = await engineFrom(seed.shared, seed.deviceA);
  const b = await engineFrom(seed.shared, seed.deviceB);
  const { mapId, nodeId } = ids(a);

  await a.recordSharedChange("node.edit", { mapSyncId: mapId, syncId: nodeId }, {
    changes: { label: "Titulo A" }
  });
  await b.recordSharedChange("node.edit", { mapSyncId: mapId, syncId: nodeId }, {
    changes: { note: "Nota B" }
  });
  await exchange(a, b);

  for (const engine of [a, b]) {
    const node = engine.sharedSnapshot.maps[0].nodes[1];
    assert.equal(node.label, "Titulo A");
    assert.equal(node.note, "Nota B");
    assert.equal(engine.getConflicts().length, 0);
  }
});

test("concurrent edits of the same field preserve both versions", async () => {
  const seed = pair();
  const a = await engineFrom(seed.shared, seed.deviceA);
  const b = await engineFrom(seed.shared, seed.deviceB);
  const { mapId, nodeId } = ids(a);

  await a.recordSharedChange("node.edit", { mapSyncId: mapId, syncId: nodeId }, {
    changes: { label: "Version A" }
  });
  await b.recordSharedChange("node.edit", { mapSyncId: mapId, syncId: nodeId }, {
    changes: { label: "Version B" }
  });
  await exchange(a, b);

  assert.equal(a.getConflicts().length, 1);
  assert.equal(b.getConflicts().length, 1);
  assert.deepEqual(
    new Set(a.getConflicts()[0].variants.map(variant => variant.value)),
    new Set(["Version A", "Version B"])
  );

  await a.resolveFieldConflict(a.getConflicts()[0].id, "Version final");
  await exchange(a, b);
  assert.equal(a.sharedSnapshot.maps[0].nodes[1].label, "Version final");
  assert.equal(b.sharedSnapshot.maps[0].nodes[1].label, "Version final");
  assert.equal(a.getConflicts().length, 0);
  assert.equal(b.getConflicts().length, 0);
});

test("concurrent moves converge deterministically without conflict", async () => {
  let timeA = 1000;
  let timeB = 2000;
  const seed = pair();
  const a = new LocalSyncEngine({
    store: new MemorySyncStore({ sharedSnapshot: seed.shared, deviceSnapshot: seed.deviceA }),
    now: () => timeA
  });
  const b = new LocalSyncEngine({
    store: new MemorySyncStore({ sharedSnapshot: seed.shared, deviceSnapshot: seed.deviceB }),
    now: () => timeB
  });
  await a.initialize();
  await b.initialize();
  const { mapId, nodeId } = ids(a);

  await a.recordSharedChange("node.move", { mapSyncId: mapId, syncId: nodeId }, {
    position: { x: 10, y: 20 }
  });
  await b.recordSharedChange("node.move", { mapSyncId: mapId, syncId: nodeId }, {
    position: { x: 90, y: 80 }
  });
  await exchange(a, b);

  for (const engine of [a, b]) {
    const node = engine.sharedSnapshot.maps[0].nodes[1];
    assert.deepEqual({ x: node.x, y: node.y }, { x: 90, y: 80 });
    assert.equal(engine.getConflicts().length, 0);
  }
});

test("concurrent delete and edit preserve work in recoveries", async () => {
  const seed = pair();
  const a = await engineFrom(seed.shared, seed.deviceA);
  const b = await engineFrom(seed.shared, seed.deviceB);
  const { mapId, nodeId } = ids(a);

  await a.recordSharedChange("node.deleteTree", { mapSyncId: mapId, syncId: nodeId }, {
    nodeSyncIds: [nodeId]
  });
  await b.recordSharedChange("node.edit", { mapSyncId: mapId, syncId: nodeId }, {
    changes: { note: "Trabajo offline" }
  });
  await exchange(a, b);

  for (const engine of [a, b]) {
    assert.equal(engine.sharedSnapshot.maps[0].nodes.some(node => node.syncId === nodeId), false);
    assert.ok(engine.getRecoveries().length >= 1);
  }
  assert.deepEqual(a.getRecoveries(), b.getRecoveries());
});

test("private device state never crosses through bundles", async () => {
  const seed = pair();
  const a = await engineFrom(seed.shared, seed.deviceA);
  const b = await engineFrom(seed.shared, seed.deviceB);
  const materialized = materializeWorkspace(a.sharedSnapshot, a.deviceSnapshot);
  materialized.state.mapsView.zoom = 9;
  const changedPrivate = captureDeviceSnapshot(materialized.state, a.deviceSnapshot);
  await a.saveDeviceState(changedPrivate);

  await exchange(a, b);
  assert.equal(a.deviceSnapshot.mapsView.zoom, 9);
  assert.notEqual(b.deviceSnapshot.mapsView?.zoom, 9);
});

test("compacted devices exchange a mergeable full snapshot", async () => {
  const seed = pair();
  const a = await engineFrom(seed.shared, seed.deviceA);
  const b = await engineFrom(seed.shared, seed.deviceB);
  const { mapId, nodeId } = ids(a);

  await a.recordSharedChange("node.edit", { mapSyncId: mapId, syncId: nodeId }, {
    changes: { label: "Meses despues" }
  });
  await a.compact();

  const bundle = a.exportBundle(b.getManifest());
  assert.ok(bundle.sharedSnapshot);
  await b.importBundle(bundle);
  assert.equal(b.sharedSnapshot.maps[0].nodes[1].label, "Meses despues");
});

test("operation imports are idempotent and tolerate reversed bundles", async () => {
  const seed = pair();
  const a = await engineFrom(seed.shared, seed.deviceA);
  const b = await engineFrom(seed.shared, seed.deviceB);
  const { mapId, nodeId } = ids(a);

  await a.recordSharedChange("node.edit", { mapSyncId: mapId, syncId: nodeId }, {
    changes: { label: "Uno" }
  });
  await a.recordSharedChange("node.edit", { mapSyncId: mapId, syncId: nodeId }, {
    changes: { note: "Dos" }
  });

  const bundle = a.exportBundle(b.getManifest());
  bundle.operations.reverse();
  await b.importBundle(bundle);
  await b.importBundle(bundle);

  assert.equal(b.sharedSnapshot.maps[0].nodes[1].label, "Uno");
  assert.equal(b.sharedSnapshot.maps[0].nodes[1].note, "Dos");
  assert.equal(b.operations.length, 2);
});

test("automatic compaction bounds the operation log", async () => {
  const seed = pair();
  const a = await engineFrom(seed.shared, seed.deviceA);
  const { mapId, nodeId } = ids(a);

  for (let index = 0; index < 501; index += 1) {
    await a.recordSharedChange("node.move", { mapSyncId: mapId, syncId: nodeId }, {
      position: { x: index, y: -index }
    });
  }

  assert.equal(a.operations.length, 1);
  assert.equal(a.sharedSnapshot.compactedVector.device_a, 500);
  assert.equal(a.sharedSnapshot.vector.device_a, 501);
});

test("concurrent creation under a deleted parent is recovered", async () => {
  const seed = pair();
  const a = await engineFrom(seed.shared, seed.deviceA);
  const b = await engineFrom(seed.shared, seed.deviceB);
  const { mapId, nodeId } = ids(a);
  const childSyncId = "node_offline_child";

  await a.recordSharedChange("node.deleteTree", { mapSyncId: mapId, syncId: nodeId }, {
    nodeSyncIds: [nodeId]
  });
  await b.recordSharedChange("node.create", { mapSyncId: mapId, syncId: childSyncId }, {
    node: {
      syncId: childSyncId,
      parentSyncId: nodeId,
      level: 2,
      isCenter: false,
      label: "Creado offline",
      note: "",
      x: 180,
      y: 40,
      versions: {}
    }
  });
  await exchange(a, b);

  for (const engine of [a, b]) {
    assert.equal(engine.sharedSnapshot.maps[0].nodes.some(node => node.syncId === childSyncId), false);
    assert.ok(engine.getRecoveries().some(item => item.targetSyncId === childSyncId));
  }
  assert.deepEqual(a.getRecoveries(), b.getRecoveries());
});

test("deleting the final map preserves a deterministic survivor and conflict", async () => {
  const seed = pair();
  const a = await engineFrom(seed.shared, seed.deviceA);
  const mapId = a.sharedSnapshot.maps[0].syncId;

  await a.recordSharedChange("map.delete", { kind: "map", syncId: mapId }, { mapSyncId: mapId });

  assert.equal(a.sharedSnapshot.maps.length, 1);
  assert.equal(a.sharedSnapshot.maps[0].syncId, mapId);
  assert.ok(a.getConflicts().some(conflict => conflict.type === "universe.empty"));
  assert.ok(a.sharedSnapshot.tombstones.some(item => item.kind === "map" && item.syncId === mapId));
});

test("independently compacted devices merge after a long offline period", async () => {
  const seed = pair();
  const a = await engineFrom(seed.shared, seed.deviceA);
  const b = await engineFrom(seed.shared, seed.deviceB);
  const { mapId, nodeId } = ids(a);

  await a.recordSharedChange("node.edit", { mapSyncId: mapId, syncId: nodeId }, {
    changes: { label: "Titulo despues de meses" }
  });
  await b.recordSharedChange("node.edit", { mapSyncId: mapId, syncId: nodeId }, {
    changes: { note: "Nota despues de meses" }
  });
  await Promise.all([a.compact(), b.compact()]);
  await exchange(a, b);

  for (const engine of [a, b]) {
    const node = engine.sharedSnapshot.maps[0].nodes[1];
    assert.equal(node.label, "Titulo despues de meses");
    assert.equal(node.note, "Nota despues de meses");
  }
});

test("content created inside a concurrently deleted map is recovered", async () => {
  const seed = pair();
  const secondMap = JSON.parse(JSON.stringify(seed.shared.maps[0]));
  secondMap.syncId = "map_second";
  for (const [index, node] of secondMap.nodes.entries()) {
    node.syncId = `map_second_node_${index}`;
    node.parentSyncId = index === 0 ? null : "map_second_node_0";
  }
  seed.shared.maps.push(secondMap);

  const a = await engineFrom(seed.shared, seed.deviceA);
  const b = await engineFrom(seed.shared, seed.deviceB);
  const deletedMap = a.sharedSnapshot.maps[0];
  const parent = deletedMap.nodes[1];
  const childSyncId = "node_created_inside_deleted_map";

  await a.recordSharedChange("map.delete", { kind: "map", syncId: deletedMap.syncId }, {
    mapSyncId: deletedMap.syncId
  });
  await b.recordSharedChange("node.create", {
    kind: "node",
    mapSyncId: deletedMap.syncId,
    syncId: childSyncId
  }, {
    node: {
      syncId: childSyncId,
      parentSyncId: parent.syncId,
      level: 2,
      isCenter: false,
      label: "Trabajo dentro del mapa",
      note: "",
      x: 220,
      y: 80,
      versions: {}
    }
  });
  await exchange(a, b);

  for (const engine of [a, b]) {
    assert.equal(engine.sharedSnapshot.maps.some(map => map.syncId === deletedMap.syncId), false);
    assert.ok(engine.getRecoveries().some(item => item.targetSyncId === childSyncId));
  }
  assert.deepEqual(a.getRecoveries(), b.getRecoveries());
});

test("resolved conflicts do not reappear after independent compaction", async () => {
  const seed = pair();
  const a = await engineFrom(seed.shared, seed.deviceA);
  const b = await engineFrom(seed.shared, seed.deviceB);
  const { mapId, nodeId } = ids(a);

  await a.recordSharedChange("node.edit", { mapSyncId: mapId, syncId: nodeId }, {
    changes: { label: "Conflicto A" }
  });
  await b.recordSharedChange("node.edit", { mapSyncId: mapId, syncId: nodeId }, {
    changes: { label: "Conflicto B" }
  });
  await exchange(a, b);
  await a.resolveFieldConflict(a.getConflicts()[0].id, "Resuelto");
  await Promise.all([a.compact(), b.compact()]);
  await exchange(a, b);

  for (const engine of [a, b]) {
    assert.equal(engine.getConflicts().length, 0);
    assert.equal(engine.sharedSnapshot.maps[0].nodes[1].label, "Resuelto");
    assert.equal(engine.sharedSnapshot.resolvedConflicts.length, 1);
  }
});

test("failed migration preserves the legacy snapshot and does not create a new universe", async () => {
  const brokenLegacy = legacyWorkspace();
  brokenLegacy.maps[0].nodes[1].parentId = 999;
  const store = new MemorySyncStore({ legacySnapshot: { id: "current", state: brokenLegacy } });
  const engine = new LocalSyncEngine({ store });

  await assert.rejects(
    () => engine.initialize(),
    error => error.code === "SYNC_MIGRATION_FAILED"
  );

  assert.equal(engine.sharedSnapshot, null);
  assert.equal((await store.load()).legacySnapshot.state.maps[0].nodes[1].parentId, 999);
});

test("the protected final map remains editable after compaction", async () => {
  const seed = pair();
  const a = await engineFrom(seed.shared, seed.deviceA);
  const b = await engineFrom(seed.shared, seed.deviceB);
  const { mapId, nodeId } = ids(a);

  await a.recordSharedChange("map.delete", { kind: "map", syncId: mapId }, { mapSyncId: mapId });
  await a.recordSharedChange("node.edit", { kind: "node", mapSyncId: mapId, syncId: nodeId }, {
    changes: { label: "Sobreviviente editable" }
  });
  await a.compact();
  await b.importBundle(a.exportBundle(b.getManifest()));

  assert.equal(b.sharedSnapshot.maps.length, 1);
  assert.equal(b.sharedSnapshot.maps[0].nodes[1].label, "Sobreviviente editable");
  assert.ok(b.sharedSnapshot.tombstones.find(item => item.kind === "map" && item.syncId === mapId)?.protected);
});
