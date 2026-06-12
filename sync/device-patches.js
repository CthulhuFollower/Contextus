import { cloneValue } from "./workspace-model.js";

export const DEVICE_PATCH_TYPES = new Set([
  "setActiveMap",
  "setSelectedNode",
  "setMapCamera",
  "setConstellationView"
]);

export function getDevicePatchKey(patch) {
  const normalized = normalizeDevicePatch(patch);
  if (normalized.type === "setActiveMap") return "activeMap";
  if (normalized.type === "setConstellationView") return "constellationView";
  if (normalized.type === "setMapCamera") return `mapCamera:${normalized.mapSyncId}`;
  return `selectedNode:${normalized.mapSyncId}`;
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizedFrame(frame, label) {
  const x = finiteNumber(frame?.x);
  const y = finiteNumber(frame?.y);
  const zoom = finiteNumber(frame?.zoom);
  if (x === null || y === null || zoom === null) {
    throw new Error(`${label} invalida.`);
  }
  return {
    x,
    y,
    targetX: finiteNumber(frame?.targetX, x),
    targetY: finiteNumber(frame?.targetY, y),
    zoom,
    targetZoom: finiteNumber(frame?.targetZoom, zoom)
  };
}

function requireSyncId(value, label) {
  if (typeof value !== "string" || !value) {
    throw new Error(`${label} invalido.`);
  }
  return value;
}

export function normalizeDevicePatch(patch) {
  if (!DEVICE_PATCH_TYPES.has(patch?.type)) {
    throw new Error(`Tipo de parche privado desconocido: ${patch?.type}`);
  }

  if (patch.type === "setActiveMap") {
    return {
      type: patch.type,
      activeMapSyncId: requireSyncId(patch.activeMapSyncId, "activeMapSyncId")
    };
  }

  if (patch.type === "setSelectedNode") {
    const selectedNodeSyncId = patch.selectedNodeSyncId;
    if (selectedNodeSyncId !== null) {
      requireSyncId(selectedNodeSyncId, "selectedNodeSyncId");
    }
    return {
      type: patch.type,
      mapSyncId: requireSyncId(patch.mapSyncId, "mapSyncId"),
      selectedNodeSyncId
    };
  }

  if (patch.type === "setMapCamera") {
    return {
      type: patch.type,
      mapSyncId: requireSyncId(patch.mapSyncId, "mapSyncId"),
      camera: normalizedFrame(patch.camera, "Camara")
    };
  }

  return {
    type: patch.type,
    view: normalizedFrame(patch.view, "Vista de constelacion")
  };
}

export function applyDevicePatchMutable(deviceSnapshot, patch) {
  const normalized = normalizeDevicePatch(patch);
  if (!deviceSnapshot) throw new Error("No existe DeviceSnapshot para aplicar el parche.");

  if (normalized.type === "setActiveMap") {
    deviceSnapshot.activeMapSyncId = normalized.activeMapSyncId;
  }

  if (normalized.type === "setSelectedNode") {
    deviceSnapshot.mapStates ||= {};
    deviceSnapshot.mapStates[normalized.mapSyncId] ||= {};
    deviceSnapshot.mapStates[normalized.mapSyncId].selectedNodeSyncId =
      normalized.selectedNodeSyncId;
  }

  if (normalized.type === "setMapCamera") {
    deviceSnapshot.mapStates ||= {};
    deviceSnapshot.mapStates[normalized.mapSyncId] ||= {};
    deviceSnapshot.mapStates[normalized.mapSyncId].camera = cloneValue(normalized.camera);
  }

  if (normalized.type === "setConstellationView") {
    deviceSnapshot.mapsView = cloneValue(normalized.view);
  }

  if (Number.isFinite(Number(patch.createdAt))) {
    deviceSnapshot.savedAt = Number(patch.createdAt);
  }
  return deviceSnapshot;
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function devicePatchChangesState(deviceSnapshot, patch) {
  const normalized = normalizeDevicePatch(patch);

  if (normalized.type === "setActiveMap") {
    return deviceSnapshot?.activeMapSyncId !== normalized.activeMapSyncId;
  }
  if (normalized.type === "setSelectedNode") {
    return deviceSnapshot?.mapStates?.[normalized.mapSyncId]?.selectedNodeSyncId
      !== normalized.selectedNodeSyncId;
  }
  if (normalized.type === "setMapCamera") {
    return !sameValue(
      deviceSnapshot?.mapStates?.[normalized.mapSyncId]?.camera || null,
      normalized.camera
    );
  }
  return !sameValue(deviceSnapshot?.mapsView || null, normalized.view);
}

export function filterChangedDevicePatches(deviceSnapshot, patches) {
  return (patches || [])
    .map(normalizeDevicePatch)
    .filter(patch => devicePatchChangesState(deviceSnapshot, patch));
}

export function sortDevicePatches(patches) {
  return [...(patches || [])].sort((left, right) =>
    (Number(left.revision) || 0) - (Number(right.revision) || 0) ||
    String(left.patchId || "").localeCompare(String(right.patchId || ""))
  );
}

export function coalesceDevicePatches(patches) {
  const byKey = new Map();
  for (const patch of sortDevicePatches(patches)) {
    const patchKey = getDevicePatchKey(patch);
    byKey.set(patchKey, {
      ...cloneValue(patch),
      patchKey
    });
  }
  return sortDevicePatches([...byKey.values()]);
}

export function replayDevicePatches(deviceSnapshot, patches) {
  const applied = new Set();
  for (const patch of sortDevicePatches(patches)) {
    if (patch.patchId && applied.has(patch.patchId)) continue;
    applyDevicePatchMutable(deviceSnapshot, patch);
    if (patch.patchId) applied.add(patch.patchId);
  }
  return deviceSnapshot;
}
