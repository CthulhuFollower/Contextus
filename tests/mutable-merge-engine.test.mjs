import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOperation,
  applyOperationMutable
} from "../sync/merge-engine.js";
import { cloneValue, migrateLegacyWorkspace } from "../sync/workspace-model.js";

function fixture() {
  const workspace = {
    version: 7,
    activeMapId: 1,
    mapIdCounter: 1,
    mapsView: null,
    maps: [{
      id: 1,
      starType: "yellow",
      nodeIdCounter: 2,
      selectedNodeId: 2,
      constellationPosition: { x: 0, y: 0 },
      camera: null,
      nodes: [
        { id: 1, parentId: null, level: 0, isCenter: true, label: "Centro", note: "", x: 0, y: 0 },
        { id: 2, parentId: 1, level: 1, isCenter: false, label: "Idea", note: "", x: 100, y: 0 }
      ],
      links: [{ from: 1, to: 2 }]
    }]
  };
  const migrated = migrateLegacyWorkspace(workspace, {
    workspaceId: "workspace_mutable",
    deviceId: "device_mutable"
  });
  const map = migrated.sharedSnapshot.maps[0];
  const node = map.nodes[1];
  return {
    snapshot: migrated.sharedSnapshot,
    operation: {
      operationId: "operation_mutable_1",
      workspaceId: migrated.sharedSnapshot.workspaceId,
      deviceId: "device_mutable",
      sequence: 1,
      context: {},
      clock: { wallTime: 1000, counter: 0, deviceId: "device_mutable" },
      type: "node.edit",
      target: { kind: "node", mapSyncId: map.syncId, syncId: node.syncId },
      payload: { changes: { label: "Editado" } }
    }
  };
}

test("mutable operation preserves root identity and matches pure application", () => {
  const { snapshot, operation } = fixture();
  const mutableInput = cloneValue(snapshot);
  const pureInput = cloneValue(snapshot);
  const pureBefore = cloneValue(pureInput);

  const mutableResult = applyOperationMutable(mutableInput, operation);
  const pureResult = applyOperation(pureInput, operation);

  assert.equal(mutableResult, mutableInput);
  assert.deepEqual(mutableResult, pureResult);
  assert.deepEqual(pureInput, pureBefore);
});

test("duplicate mutable operations are idempotent and preserve identity", () => {
  const { snapshot, operation } = fixture();
  const mutableInput = cloneValue(snapshot);

  const first = applyOperationMutable(mutableInput, operation);
  const afterFirst = cloneValue(first);
  const second = applyOperationMutable(mutableInput, operation);

  assert.equal(first, mutableInput);
  assert.equal(second, mutableInput);
  assert.deepEqual(second, afterFirst);
});

test("mutable operation validates workspace before changing the snapshot", () => {
  const { snapshot, operation } = fixture();
  const mutableInput = cloneValue(snapshot);
  const before = cloneValue(mutableInput);

  assert.throws(
    () => applyOperationMutable(mutableInput, { ...operation, workspaceId: "otro_workspace" }),
    /otro universo/
  );
  assert.deepEqual(mutableInput, before);
});
