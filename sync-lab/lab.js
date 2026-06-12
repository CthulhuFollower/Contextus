import { createIndexedDbSyncStore } from "../sync/indexeddb-store.js";
import { LocalSyncEngine } from "../sync/local-sync-engine.js";

const DB_A = "contextus-sync-lab-device-a";
const DB_B = "contextus-sync-lab-device-b";
const status = document.getElementById("status");
const outputA = document.getElementById("deviceA");
const outputB = document.getElementById("deviceB");

let engineA;
let engineB;

function initialWorkspace() {
  return {
    version: 7,
    activeMapId: 1,
    mapIdCounter: 1,
    mapsView: null,
    maps: [{
      id: 1,
      starType: "yellow",
      starVariant: "pure",
      starScale: 1,
      starLuminosity: 1,
      nodeIdCounter: 2,
      selectedNodeId: 2,
      constellationPosition: { x: 0, y: 0 },
      camera: { x: 0, y: 0, targetX: 0, targetY: 0, zoom: 1, targetZoom: 1 },
      nodes: [
        { id: 1, parentId: null, level: 0, isCenter: true, label: "Laboratorio", note: "", x: 0, y: 0 },
        { id: 2, parentId: 1, level: 1, isCenter: false, label: "Idea compartida", note: "Base", x: 140, y: 0 }
      ],
      links: [{ from: 1, to: 2 }]
    }]
  };
}

function createEngine(dbName) {
  return new LocalSyncEngine({
    store: createIndexedDbSyncStore({ dbName })
  });
}

function target(engine) {
  const map = engine.sharedSnapshot?.maps?.[0];
  const node = map?.nodes?.find(candidate => !candidate.isCenter) || map?.nodes?.[0];
  return {
    map,
    node,
    target: node ? { kind: "node", mapSyncId: map.syncId, syncId: node.syncId } : null
  };
}

function summary(engine) {
  if (!engine?.sharedSnapshot) return { empty: true };
  return {
    manifest: engine.getManifest(),
    deviceId: engine.deviceSnapshot?.deviceId,
    operations: engine.operations,
    maps: engine.sharedSnapshot.maps,
    conflicts: engine.getConflicts(),
    resolvedConflicts: engine.sharedSnapshot.resolvedConflicts,
    recoveries: engine.getRecoveries(),
    tombstones: engine.sharedSnapshot.tombstones
  };
}

function render(message = "") {
  status.textContent = message;
  outputA.textContent = JSON.stringify(summary(engineA), null, 2);
  outputB.textContent = JSON.stringify(summary(engineB), null, 2);
}

async function reset() {
  engineA = createEngine(DB_A);
  engineB = createEngine(DB_B);
  await Promise.all([engineA.store.clear(), engineB.store.clear()]);
  await engineA.initialize({ legacyState: initialWorkspace(), workspaceId: "workspace_sync_lab", deviceId: "lab_a" });
  await engineB.initialize();
  await engineB.importBundle(engineA.exportBundle(null));
  render("Universo recreado y vinculado.");
}

async function restart() {
  engineA = createEngine(DB_A);
  engineB = createEngine(DB_B);
  await Promise.all([engineA.initialize(), engineB.initialize()]);
  render("Motores reiniciados desde IndexedDB.");
}

async function exchange() {
  const bundleA = engineA.exportBundle(engineB.getManifest());
  const bundleB = engineB.exportBundle(engineA.getManifest());
  await engineA.importBundle(bundleB);
  await engineB.importBundle(bundleA);
  render("Bundles intercambiados.");
}

async function edit(engine, value) {
  const item = target(engine);
  if (!item.node) return;
  await engine.recordSharedChange("node.edit", item.target, {
    changes: { label: value }
  });
}

async function note(engine, value) {
  const item = target(engine);
  if (!item.node) return;
  await engine.recordSharedChange("node.edit", item.target, {
    changes: { note: value }
  });
}

async function move(engine, x, y) {
  const item = target(engine);
  if (!item.node) return;
  await engine.recordSharedChange("node.move", item.target, {
    position: { x, y }
  });
}

async function deleteNode(engine) {
  const item = target(engine);
  if (!item.node) return;
  await engine.recordSharedChange("node.deleteTree", item.target, {
    nodeSyncIds: [item.node.syncId]
  });
}

async function handleAction(action) {
  if (action === "reset") return reset();
  if (action === "restart") return restart();
  if (action === "exchange") return exchange();
  if (action === "clear") {
    await Promise.all([engineA.store.clear(), engineB.store.clear()]);
    engineA = createEngine(DB_A);
    engineB = createEngine(DB_B);
    await Promise.all([engineA.initialize(), engineB.initialize()]);
    return render("Laboratorio limpio.");
  }
  if (action === "compact") {
    await Promise.all([engineA.compact(), engineB.compact()]);
    return render("Ambos historiales fueron compactados.");
  }
  if (action === "resolve") {
    const conflict = engineA.getConflicts()[0] || engineB.getConflicts()[0];
    if (!conflict) return render("No hay conflictos por resolver.");
    const owner = engineA.getConflicts().some(item => item.id === conflict.id) ? engineA : engineB;
    await owner.resolveFieldConflict(conflict.id, "Version reconciliada");
    return render("Primer conflicto resuelto en un dispositivo. Intercambia bundles para propagarlo.");
  }
  if (action === "edit-a") await edit(engineA, `Titulo A ${Date.now()}`);
  if (action === "edit-b") await edit(engineB, `Titulo B ${Date.now()}`);
  if (action === "note-b") await note(engineB, `Trabajo offline B ${Date.now()}`);
  if (action === "move-a") await move(engineA, 80, 160);
  if (action === "move-b") await move(engineB, 260, -90);
  if (action === "delete-a") await deleteNode(engineA);
  render(`Accion ${action} aplicada.`);
}

document.querySelector(".controls").addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  button.disabled = true;
  handleAction(button.dataset.action)
    .catch(error => {
      console.error(error);
      render(`Error: ${error.message}`);
    })
    .finally(() => {
      button.disabled = false;
    });
});

restart()
  .then(() => {
    if (!engineA.sharedSnapshot || !engineB.sharedSnapshot) return reset();
    render("Laboratorio restaurado.");
  })
  .catch(error => {
    console.error(error);
    reset().catch(resetError => render(`Error: ${resetError.message}`));
  });
