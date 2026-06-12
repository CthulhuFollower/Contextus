import { LocalSyncEngine, MemorySyncStore } from "../sync/local-sync-engine.js";
import {
  captureDeviceSnapshot,
  cloneValue,
  migrateLegacyWorkspace,
  sharedNodeFromRuntime
} from "../sync/workspace-model.js";
import { createMentalMapDataset } from "./dataset-generator.js";

export const PERF_004_SCENARIOS = [
  "edit-text",
  "move-node",
  "create-node",
  "delete-leaf",
  "delete-large"
];

function collectDescendantIds(nodes, rootId) {
  const childrenByParent = new Map();
  for (const node of nodes) {
    const children = childrenByParent.get(node.parentId) || [];
    children.push(node.id);
    childrenByParent.set(node.parentId, children);
  }

  const ids = new Set([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const current = stack.pop();
    for (const childId of childrenByParent.get(current) || []) {
      ids.add(childId);
      stack.push(childId);
    }
  }
  return ids;
}

function createWorkspace(nodeCount, noteSize) {
  const dataset = createMentalMapDataset({
    nodeCount,
    shape: "balanced",
    branchingFactor: 4,
    noteSize
  });
  dataset.map.selectedNodeId = dataset.nodes.at(-1).id;

  return {
    version: 7,
    activeMapId: dataset.map.id,
    mapIdCounter: dataset.map.id,
    mapsView: { x: 0, y: 0, targetX: 0, targetY: 0, zoom: 1, targetZoom: 1 },
    maps: [dataset.map]
  };
}

export function createPerf004Fixture({
  nodeCount,
  scenario,
  noteSize = 100,
  workspaceId = `workspace_perf004_${nodeCount}`,
  deviceId = `device_perf004_${nodeCount}`
}) {
  if (!PERF_004_SCENARIOS.includes(scenario)) {
    throw new RangeError(`Unknown PERF-004 scenario: ${scenario}`);
  }

  const initialWorkspace = createWorkspace(nodeCount, noteSize);
  const migrated = migrateLegacyWorkspace(initialWorkspace, { workspaceId, deviceId });
  const mutatedWorkspace = cloneValue(initialWorkspace);
  const map = mutatedWorkspace.maps[0];
  const mapSyncId = map.syncId;
  const target = map.nodes.at(-1);
  let change;
  let deletedNodeCount = 0;

  if (scenario === "edit-text") {
    target.label = `Editado ${nodeCount}`;
    target.note = `${target.note} Cambio PERF-004`;
    change = {
      type: "node.edit",
      target: { kind: "node", mapSyncId, syncId: target.syncId },
      payload: {
        mapSyncId,
        nodeSyncId: target.syncId,
        changes: { label: target.label, note: target.note }
      }
    };
  }

  if (scenario === "move-node") {
    target.x += 37;
    target.y -= 19;
    change = {
      type: "node.move",
      target: { kind: "node", mapSyncId, syncId: target.syncId },
      payload: {
        mapSyncId,
        nodeSyncId: target.syncId,
        position: { x: target.x, y: target.y }
      }
    };
  }

  if (scenario === "create-node") {
    const parent = map.nodes[0];
    const created = {
      id: nodeCount + 1,
      syncId: `node_perf004_created_${nodeCount}`,
      parentId: parent.id,
      parentSyncId: parent.syncId,
      level: 1,
      isCenter: false,
      label: "Creado PERF-004",
      note: "Nuevo contenido",
      x: 180,
      y: -90
    };
    map.nodes.push(created);
    map.links.push({ from: parent.id, to: created.id });
    map.nodeIdCounter = created.id;
    map.selectedNodeId = created.id;
    change = {
      type: "node.create",
      target: { kind: "node", mapSyncId, syncId: created.syncId },
      payload: { mapSyncId, node: sharedNodeFromRuntime(created) }
    };
  }

  if (scenario === "delete-leaf" || scenario === "delete-large") {
    const root = scenario === "delete-leaf" ? target : map.nodes[1];
    const deletedIds = collectDescendantIds(map.nodes, root.id);
    const deletedSyncIds = map.nodes
      .filter(node => deletedIds.has(node.id))
      .map(node => node.syncId);
    deletedNodeCount = deletedIds.size;
    map.nodes = map.nodes.filter(node => !deletedIds.has(node.id));
    map.links = map.links.filter(link => !deletedIds.has(link.from) && !deletedIds.has(link.to));
    map.selectedNodeId = root.parentId;
    change = {
      type: "node.deleteTree",
      target: { kind: "node", mapSyncId, syncId: root.syncId },
      payload: { mapSyncId, nodeSyncIds: deletedSyncIds }
    };
  }

  return {
    nodeCount,
    scenario,
    noteSize,
    deletedNodeCount,
    initialWorkspace,
    mutatedWorkspace,
    initialSharedSnapshot: migrated.sharedSnapshot,
    initialDeviceSnapshot: migrated.deviceSnapshot,
    change
  };
}

export class ProfilingSyncStore {
  constructor(delegate) {
    this.delegate = delegate;
    this.calls = [];
  }

  resetProfile() {
    this.calls = [];
  }

  async profile(name, task) {
    const startedAt = performance.now();
    const result = await task();
    this.calls.push({ name, durationMs: performance.now() - startedAt, result: cloneValue(result) });
    return result;
  }

  load() {
    return this.profile("load", () => this.delegate.load());
  }

  writeMigration(value) {
    return this.profile("writeMigration", () => this.delegate.writeMigration(value));
  }

  commitShared(sharedSnapshot, operation) {
    return this.profile("commitShared", () => this.delegate.commitShared(sharedSnapshot, operation));
  }

  saveDevice(deviceSnapshot) {
    return this.profile("saveDevice", () => this.delegate.saveDevice(deviceSnapshot));
  }

  commitDevicePatches(patches) {
    return this.profile("commitDevicePatches", () => this.delegate.commitDevicePatches(patches));
  }

  replaceSyncState(sharedSnapshot, operations) {
    return this.profile("replaceSyncState", () => this.delegate.replaceSyncState(sharedSnapshot, operations));
  }

  ensureCheckpoint(sharedSnapshot, operations) {
    return this.profile("ensureCheckpoint", () => this.delegate.ensureCheckpoint(sharedSnapshot, operations));
  }

  publishCheckpoint(sharedSnapshot) {
    return this.profile("publishCheckpoint", () => this.delegate.publishCheckpoint(sharedSnapshot));
  }

  pruneOperations(operations) {
    return this.profile("pruneOperations", () => this.delegate.pruneOperations(operations));
  }

  pruneCheckpoints() {
    return this.profile("pruneCheckpoints", () => this.delegate.pruneCheckpoints());
  }

  clear() {
    return this.profile("clear", () => this.delegate.clear());
  }
}

export async function createMemoryEngineForPerf004(fixture) {
  const store = new ProfilingSyncStore(new MemorySyncStore({
    sharedSnapshot: fixture.initialSharedSnapshot,
    deviceSnapshot: fixture.initialDeviceSnapshot
  }));
  const engine = new LocalSyncEngine({ store });
  await engine.initialize();
  store.resetProfile();
  return { engine, store };
}

function serializeMeasurement(value) {
  const startedAt = performance.now();
  const json = JSON.stringify(value);
  return {
    durationMs: performance.now() - startedAt,
    bytes: new TextEncoder().encode(json).byteLength
  };
}

export async function runPerf004Commit(engine, store, fixture) {
  const stages = {};
  const totalStartedAt = performance.now();

  let startedAt = performance.now();
  const capturedWorkspace = cloneValue(fixture.mutatedWorkspace);
  stages.captureWorkspaceMs = performance.now() - startedAt;

  startedAt = performance.now();
  const deviceState = captureDeviceSnapshot(capturedWorkspace, engine.deviceSnapshot);
  stages.captureDeviceMs = performance.now() - startedAt;

  startedAt = performance.now();
  await engine.recordSharedChange(
    fixture.change.type,
    fixture.change.target,
    fixture.change.payload
  );
  stages.recordSharedChangeMs = performance.now() - startedAt;

  startedAt = performance.now();
  await engine.saveDeviceState(deviceState);
  stages.saveDeviceStateMs = performance.now() - startedAt;
  stages.commitCompleteMs = performance.now() - totalStartedAt;

  const sharedSerialization = serializeMeasurement(engine.sharedSnapshot);
  const deviceSerialization = serializeMeasurement(engine.deviceSnapshot);
  const operationsSerialization = serializeMeasurement(engine.operations);

  return {
    stages,
    storeCalls: cloneValue(store.calls),
    bytes: {
      sharedSnapshot: sharedSerialization.bytes,
      deviceSnapshot: deviceSerialization.bytes,
      operations: operationsSerialization.bytes,
      total:
        sharedSerialization.bytes +
        deviceSerialization.bytes +
        operationsSerialization.bytes
    },
    serializationMs: {
      sharedSnapshot: sharedSerialization.durationMs,
      deviceSnapshot: deviceSerialization.durationMs,
      operations: operationsSerialization.durationMs,
      total:
        sharedSerialization.durationMs +
        deviceSerialization.durationMs +
        operationsSerialization.durationMs
    }
  };
}

export function summarizeSamples(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = fraction => {
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
    return sorted[Math.max(0, index)];
  };
  return {
    samples: sorted.length,
    min: sorted[0],
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1)
  };
}
