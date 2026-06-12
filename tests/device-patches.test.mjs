import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDevicePatchMutable,
  coalesceDevicePatches,
  filterChangedDevicePatches,
  getDevicePatchKey,
  replayDevicePatches
} from "../sync/device-patches.js";

function deviceSnapshot() {
  return {
    workspaceId: "workspace_private",
    deviceId: "device_private",
    activeMapSyncId: "map-a",
    mapsView: { x: 0, y: 0, targetX: 0, targetY: 0, zoom: 1, targetZoom: 1 },
    mapAliases: { "map-a": 1 },
    nodeAliases: { "map-a": { "node-a": 1, "node-b": 2 } },
    mapStates: {
      "map-a": {
        selectedNodeSyncId: "node-a",
        camera: { x: 0, y: 0, targetX: 0, targetY: 0, zoom: 1, targetZoom: 1 }
      }
    }
  };
}

test("each private patch modifies only its declared field", () => {
  const initial = deviceSnapshot();
  const selected = structuredClone(initial);
  applyDevicePatchMutable(selected, {
    type: "setSelectedNode",
    mapSyncId: "map-a",
    selectedNodeSyncId: "node-b"
  });
  assert.equal(selected.mapStates["map-a"].selectedNodeSyncId, "node-b");
  assert.deepEqual(selected.mapStates["map-a"].camera, initial.mapStates["map-a"].camera);

  const camera = structuredClone(initial);
  applyDevicePatchMutable(camera, {
    type: "setMapCamera",
    mapSyncId: "map-a",
    camera: { x: 5, y: 7, zoom: 2 }
  });
  assert.equal(camera.mapStates["map-a"].selectedNodeSyncId, "node-a");
  assert.deepEqual(camera.mapStates["map-a"].camera, {
    x: 5,
    y: 7,
    targetX: 5,
    targetY: 7,
    zoom: 2,
    targetZoom: 2
  });

  const active = structuredClone(initial);
  applyDevicePatchMutable(active, { type: "setActiveMap", activeMapSyncId: "map-b" });
  assert.equal(active.activeMapSyncId, "map-b");
  assert.deepEqual(active.mapStates, initial.mapStates);

  const constellation = structuredClone(initial);
  applyDevicePatchMutable(constellation, {
    type: "setConstellationView",
    view: { x: 11, y: 13, zoom: 3 }
  });
  assert.deepEqual(constellation.mapsView, {
    x: 11,
    y: 13,
    targetX: 11,
    targetY: 13,
    zoom: 3,
    targetZoom: 3
  });
  assert.deepEqual(constellation.mapStates, initial.mapStates);
});

test("private patch replay is ordered and duplicate-safe", () => {
  const device = deviceSnapshot();
  replayDevicePatches(device, [
    {
      patchId: "patch-late",
      revision: 2,
      type: "setSelectedNode",
      mapSyncId: "map-a",
      selectedNodeSyncId: "node-b"
    },
    {
      patchId: "patch-early",
      revision: 1,
      type: "setSelectedNode",
      mapSyncId: "map-a",
      selectedNodeSyncId: null
    },
    {
      patchId: "patch-late",
      revision: 3,
      type: "setSelectedNode",
      mapSyncId: "map-a",
      selectedNodeSyncId: null
    }
  ]);

  assert.equal(device.mapStates["map-a"].selectedNodeSyncId, "node-b");
});

test("private patch filtering keeps only fields that actually changed", () => {
  const device = deviceSnapshot();
  const patches = filterChangedDevicePatches(device, [
    {
      type: "setSelectedNode",
      mapSyncId: "map-a",
      selectedNodeSyncId: "node-a"
    },
    {
      type: "setMapCamera",
      mapSyncId: "map-a",
      camera: { x: 9, y: 4, zoom: 2 }
    },
    {
      type: "setConstellationView",
      view: device.mapsView
    }
  ]);

  assert.deepEqual(patches.map(patch => patch.type), ["setMapCamera"]);
});

test("private patch keys isolate global, camera, and selection state", () => {
  assert.equal(getDevicePatchKey({ type: "setActiveMap", activeMapSyncId: "map-a" }), "activeMap");
  assert.equal(
    getDevicePatchKey({ type: "setConstellationView", view: { x: 0, y: 0, zoom: 1 } }),
    "constellationView"
  );
  assert.equal(
    getDevicePatchKey({
      type: "setMapCamera",
      mapSyncId: "map-a",
      camera: { x: 0, y: 0, zoom: 1 }
    }),
    "mapCamera:map-a"
  );
  assert.equal(
    getDevicePatchKey({
      type: "setSelectedNode",
      mapSyncId: "map-a",
      selectedNodeSyncId: null
    }),
    "selectedNode:map-a"
  );
});

test("historical private patches coalesce to the last revision per structural key", () => {
  const coalesced = coalesceDevicePatches([
    {
      patchId: "camera-a-1",
      revision: 1,
      type: "setMapCamera",
      mapSyncId: "map-a",
      camera: { x: 1, y: -1, zoom: 1 }
    },
    {
      patchId: "selected-a-1",
      revision: 2,
      type: "setSelectedNode",
      mapSyncId: "map-a",
      selectedNodeSyncId: "node-a"
    },
    {
      patchId: "camera-b-1",
      revision: 3,
      type: "setMapCamera",
      mapSyncId: "map-b",
      camera: { x: 3, y: -3, zoom: 1 }
    },
    {
      patchId: "camera-a-2",
      revision: 4,
      type: "setMapCamera",
      mapSyncId: "map-a",
      camera: { x: 4, y: -4, zoom: 2 }
    },
    {
      patchId: "active-1",
      revision: 5,
      type: "setActiveMap",
      activeMapSyncId: "map-b"
    },
    {
      patchId: "selected-a-2",
      revision: 6,
      type: "setSelectedNode",
      mapSyncId: "map-a",
      selectedNodeSyncId: null
    }
  ]);

  assert.deepEqual(coalesced.map(patch => patch.patchKey), [
    "mapCamera:map-b",
    "mapCamera:map-a",
    "activeMap",
    "selectedNode:map-a"
  ]);
  assert.equal(coalesced.find(patch => patch.patchKey === "mapCamera:map-a").camera.x, 4);
  assert.equal(coalesced.find(patch => patch.patchKey === "selectedNode:map-a").selectedNodeSyncId, null);
});
