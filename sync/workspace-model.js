import { measureStartupSync } from "../runtime/startup-profiler.js";

export const SHARED_SCHEMA_VERSION = 1;
export const DEVICE_SCHEMA_VERSION = 1;

export function cloneValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export function createSyncId(prefix = "id") {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}_${uuid}`;

  const random = Math.random().toString(36).slice(2);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function createEmptySharedSnapshot(workspaceId = createSyncId("workspace")) {
  return {
    schemaVersion: SHARED_SCHEMA_VERSION,
    workspaceId,
    maps: [],
    tombstones: [],
    conflicts: [],
    resolvedConflicts: [],
    recoveries: [],
    vector: {},
    compactedVector: {},
    savedAt: Date.now()
  };
}

export function createEmptyDeviceSnapshot(workspaceId, deviceId = createSyncId("device")) {
  return {
    schemaVersion: DEVICE_SCHEMA_VERSION,
    workspaceId,
    deviceId,
    savedAt: Date.now(),
    activeMapSyncId: null,
    mapsView: null,
    mapAliases: {},
    nodeAliases: {},
    mapStates: {},
    mapIdCounter: 0
  };
}

function normalizePosition(position) {
  if (!position) return null;
  const x = Number(position.x);
  const y = Number(position.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function normalizeCamera(camera) {
  const source = camera || {};
  const x = Number.isFinite(Number(source.x)) ? Number(source.x) : 0;
  const y = Number.isFinite(Number(source.y)) ? Number(source.y) : 0;
  const zoom = Number.isFinite(Number(source.zoom)) ? Number(source.zoom) : 1;
  return {
    x,
    y,
    targetX: Number.isFinite(Number(source.targetX)) ? Number(source.targetX) : x,
    targetY: Number.isFinite(Number(source.targetY)) ? Number(source.targetY) : y,
    zoom,
    targetZoom: Number.isFinite(Number(source.targetZoom)) ? Number(source.targetZoom) : zoom
  };
}

function emptyNodeVersions() {
  return {
    create: null,
    label: null,
    note: null,
    position: null,
    parent: null
  };
}

function emptyMapVersions() {
  return {
    create: null,
    constellationPosition: null
  };
}

export function ensureRuntimeSyncIds(workspaceState) {
  if (!workspaceState || !Array.isArray(workspaceState.maps)) return workspaceState;

  for (const map of workspaceState.maps) {
    if (!map.syncId) map.syncId = createSyncId("map");
    if (!Array.isArray(map.nodes)) map.nodes = [];

    const nodeSyncIds = new Map();
    for (const node of map.nodes) {
      if (!node.syncId) node.syncId = createSyncId("node");
      nodeSyncIds.set(node.id, node.syncId);
    }

    for (const node of map.nodes) {
      node.parentSyncId = node.parentId === null || node.parentId === undefined
        ? null
        : nodeSyncIds.get(node.parentId) || node.parentSyncId || null;
    }
  }

  return workspaceState;
}

export function sharedNodeFromRuntime(node) {
  return {
    syncId: node.syncId || createSyncId("node"),
    parentSyncId: node.parentSyncId || null,
    level: Number.isFinite(Number(node.level)) ? Number(node.level) : 0,
    isCenter: Boolean(node.isCenter),
    label: typeof node.label === "string" ? node.label : "",
    note: typeof node.note === "string" ? node.note : "",
    x: Number.isFinite(Number(node.x)) ? Number(node.x) : 0,
    y: Number.isFinite(Number(node.y)) ? Number(node.y) : 0,
    versions: cloneValue(node.versions || emptyNodeVersions())
  };
}

export function sharedMapFromRuntime(map) {
  const runtime = ensureRuntimeSyncIds({ maps: [map] }).maps[0];
  return {
    syncId: runtime.syncId,
    starType: runtime.starType,
    starVariant: runtime.starVariant,
    starScale: runtime.starScale,
    starLuminosity: runtime.starLuminosity,
    constellationPosition: normalizePosition(runtime.constellationPosition),
    versions: cloneValue(runtime.versions || emptyMapVersions()),
    nodes: runtime.nodes.map(sharedNodeFromRuntime)
  };
}

export function captureSharedSnapshot(workspaceState, existingSnapshot = null) {
  ensureRuntimeSyncIds(workspaceState);
  const shared = existingSnapshot
    ? cloneValue(existingSnapshot)
    : createEmptySharedSnapshot();

  shared.maps = workspaceState.maps.map(sharedMapFromRuntime);
  shared.savedAt = Date.now();
  return shared;
}

export function captureDeviceSnapshot(workspaceState, existingDevice = null, deviceId = null) {
  ensureRuntimeSyncIds(workspaceState);

  const workspaceId = existingDevice?.workspaceId || createSyncId("workspace");
  const device = existingDevice
    ? cloneValue(existingDevice)
    : createEmptyDeviceSnapshot(workspaceId, deviceId || undefined);

  const mapByNumericId = new Map(workspaceState.maps.map(map => [map.id, map]));
  const activeMap = mapByNumericId.get(workspaceState.activeMapId) || workspaceState.maps[0] || null;

  device.activeMapSyncId = activeMap?.syncId || null;
  device.mapsView = cloneValue(workspaceState.mapsView || null);
  device.mapIdCounter = Number.isFinite(Number(workspaceState.mapIdCounter))
    ? Number(workspaceState.mapIdCounter)
    : 0;
  device.mapAliases ||= {};
  device.nodeAliases ||= {};
  device.mapStates ||= {};

  for (const map of workspaceState.maps) {
    device.mapAliases[map.syncId] = map.id;
    device.nodeAliases[map.syncId] ||= {};

    for (const node of map.nodes || []) {
      device.nodeAliases[map.syncId][node.syncId] = node.id;
    }

    const selectedNode = (map.nodes || []).find(node => node.id === map.selectedNodeId);
    device.mapStates[map.syncId] = {
      selectedNodeSyncId: selectedNode?.syncId || null,
      camera: normalizeCamera(map.camera)
    };
  }

  device.savedAt = Date.now();
  return device;
}

export function migrateLegacyWorkspace(legacyState, options = {}) {
  const state = cloneValue(legacyState);
  ensureRuntimeSyncIds(state);

  const workspaceId = options.workspaceId || createSyncId("workspace");
  const deviceId = options.deviceId || createSyncId("device");
  const shared = captureSharedSnapshot(state, createEmptySharedSnapshot(workspaceId));
  const device = captureDeviceSnapshot(
    state,
    createEmptyDeviceSnapshot(workspaceId, deviceId),
    deviceId
  );

  return { sharedSnapshot: shared, deviceSnapshot: device };
}

export function validateMigratedWorkspace(legacyState, migrated) {
  const legacy = cloneValue(legacyState);
  ensureRuntimeSyncIds(legacy);
  const materialized = materializeWorkspace(migrated.sharedSnapshot, migrated.deviceSnapshot).state;

  if ((legacy.maps || []).length !== materialized.maps.length) {
    throw new Error("La migracion no reconstruyo todos los mapas.");
  }

  for (const legacyMap of legacy.maps || []) {
    const restoredMap = materialized.maps.find(map => map.id === legacyMap.id);
    if (!restoredMap || (legacyMap.nodes || []).length !== restoredMap.nodes.length) {
      throw new Error("La migracion no reconstruyo todos los nodos.");
    }

    for (const legacyNode of legacyMap.nodes || []) {
      const restoredNode = restoredMap.nodes.find(node => node.id === legacyNode.id);
      if (
        !restoredNode ||
        restoredNode.parentId !== (legacyNode.parentId ?? null) ||
        restoredNode.label !== legacyNode.label ||
        (restoredNode.note || "") !== (legacyNode.note || "") ||
        Number(restoredNode.x) !== Number(legacyNode.x) ||
        Number(restoredNode.y) !== Number(legacyNode.y)
      ) {
        throw new Error("La migracion altero contenido o relaciones de nodos.");
      }
    }
  }

  return true;
}

function nextAlias(used, preferred, counterRef) {
  const numericPreferred = Number(preferred);
  if (Number.isFinite(numericPreferred) && numericPreferred > 0 && !used.has(numericPreferred)) {
    used.add(numericPreferred);
    counterRef.value = Math.max(counterRef.value, numericPreferred);
    return numericPreferred;
  }

  do {
    counterRef.value += 1;
  } while (used.has(counterRef.value));

  used.add(counterRef.value);
  return counterRef.value;
}

export function materializeWorkspace(sharedSnapshot, deviceSnapshot, options = {}) {
  const profiler = options.profiler || null;
  const endMaterialize = profiler?.start?.("hydration.materialize.total");
  try {
    const shared = measureStartupSync(
      profiler,
      "hydration.materialize.cloneShared",
      () => cloneValue(sharedSnapshot)
    );
    const device = measureStartupSync(
      profiler,
      "hydration.materialize.cloneDevice",
      () => deviceSnapshot
        ? cloneValue(deviceSnapshot)
        : createEmptyDeviceSnapshot(shared.workspaceId)
    );

    device.workspaceId = shared.workspaceId;
    device.mapAliases ||= {};
    device.nodeAliases ||= {};
    device.mapStates ||= {};

    const usedMapIds = new Set();
    const mapCounter = { value: Number(device.mapIdCounter) || 0 };
    const maps = [];

    for (const sharedMap of shared.maps || []) {
      const mapId = nextAlias(usedMapIds, device.mapAliases[sharedMap.syncId], mapCounter);
      device.mapAliases[sharedMap.syncId] = mapId;
      device.nodeAliases[sharedMap.syncId] ||= {};

      const usedNodeIds = new Set();
      const nodeCounter = { value: 0 };
      const nodeIdBySyncId = new Map();

      measureStartupSync(profiler, "hydration.materialize.aliasNodes", () => {
        for (const sharedNode of sharedMap.nodes || []) {
          const nodeId = nextAlias(
            usedNodeIds,
            device.nodeAliases[sharedMap.syncId][sharedNode.syncId],
            nodeCounter
          );
          device.nodeAliases[sharedMap.syncId][sharedNode.syncId] = nodeId;
          nodeIdBySyncId.set(sharedNode.syncId, nodeId);
        }
      }, { mapSyncId: sharedMap.syncId, nodeCount: sharedMap.nodes?.length || 0 });

      const nodes = measureStartupSync(
        profiler,
        "hydration.materialize.nodes",
        () => (sharedMap.nodes || []).map(sharedNode => ({
          id: nodeIdBySyncId.get(sharedNode.syncId),
          syncId: sharedNode.syncId,
          parentId: sharedNode.parentSyncId ? nodeIdBySyncId.get(sharedNode.parentSyncId) ?? null : null,
          parentSyncId: sharedNode.parentSyncId || null,
          level: sharedNode.level,
          isCenter: Boolean(sharedNode.isCenter),
          label: sharedNode.label,
          note: sharedNode.note || "",
          x: sharedNode.x,
          y: sharedNode.y,
          versions: cloneValue(sharedNode.versions || emptyNodeVersions())
        })),
        { mapSyncId: sharedMap.syncId, nodeCount: sharedMap.nodes?.length || 0 }
      );

      const links = measureStartupSync(
        profiler,
        "hydration.materialize.links",
        () => nodes
          .filter(node => node.parentId !== null)
          .map(node => ({ from: node.parentId, to: node.id })),
        { mapSyncId: sharedMap.syncId, nodeCount: nodes.length }
      );
      const privateState = device.mapStates[sharedMap.syncId] || {};
      const selectedNodeId = privateState.selectedNodeSyncId
        ? nodeIdBySyncId.get(privateState.selectedNodeSyncId) ?? nodes[0]?.id ?? null
        : nodes[0]?.id ?? null;

      maps.push({
        id: mapId,
        syncId: sharedMap.syncId,
        starType: sharedMap.starType,
        starVariant: sharedMap.starVariant,
        starScale: sharedMap.starScale,
        starLuminosity: sharedMap.starLuminosity,
        versions: cloneValue(sharedMap.versions || emptyMapVersions()),
        nodeIdCounter: nodeCounter.value,
        selectedNodeId,
        constellationPosition: normalizePosition(sharedMap.constellationPosition),
        camera: normalizeCamera(privateState.camera),
        nodes,
        links
      });
    }

    const activeMapId = maps.find(map => map.syncId === device.activeMapSyncId)?.id
      ?? maps[0]?.id
      ?? null;

    device.mapIdCounter = mapCounter.value;
    device.activeMapSyncId = maps.find(map => map.id === activeMapId)?.syncId || null;
    device.savedAt = Date.now();

    return {
      state: {
        version: 7,
        activeMapId,
        mapIdCounter: mapCounter.value,
        mapsView: cloneValue(device.mapsView || null),
        maps
      },
      deviceSnapshot: device
    };
  } finally {
    endMaterialize?.();
  }
}
