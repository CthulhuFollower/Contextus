import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  TRANSACTION_PERSISTENCE_CONTRACT,
  createFastSharedChange,
  getTransactionPersistenceContract,
  requiresWorkspaceCapture
} from "../runtime/transaction-persistence.js";

test("transaction persistence contract covers every current transaction type", () => {
  const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const emittedTypes = [...indexSource.matchAll(/commitLocalTransaction\("([^"]+)"/g)]
    .map(match => match[1]);

  assert.deepEqual(
    Object.keys(TRANSACTION_PERSISTENCE_CONTRACT).sort(),
    [...new Set(emittedTypes)].sort()
  );
});

test("shared-only edits and moves do not require private persistence", () => {
  for (const type of ["editNode", "moveNode", "moveConstellationMap"]) {
    assert.deepEqual(
      getTransactionPersistenceContract(type),
      { shared: true, private: false, fastShared: true }
    );
  }
});

test("transactions that can alter private state retain private persistence", () => {
  for (const type of [
    "deleteMapAndSelectFallback",
    "updateViewFrame",
    "switchMap",
    "createMap",
    "createNode",
    "deleteNodeTree"
  ]) {
    assert.equal(getTransactionPersistenceContract(type).private, true);
  }
});

test("only view and map switching transactions use incremental private patches", () => {
  assert.equal(getTransactionPersistenceContract("updateViewFrame").fastPrivate, true);
  assert.equal(getTransactionPersistenceContract("switchMap").fastPrivate, true);
  for (const type of [
    "createMap",
    "createNode",
    "deleteNodeTree",
    "deleteMapAndSelectFallback"
  ]) {
    assert.notEqual(getTransactionPersistenceContract(type).fastPrivate, true);
  }
});

test("unknown transaction types require an explicit persistence decision", () => {
  assert.throws(
    () => getTransactionPersistenceContract("futureTransaction"),
    /Unknown transaction persistence contract/
  );
});

test("fast shared changes are built only with complete identities and payloads", () => {
  const identity = { mapSyncId: "map-1", nodeSyncId: "node-1" };
  assert.deepEqual(
    createFastSharedChange("moveNode", { to: { x: 12, y: -4 } }, identity),
    {
      type: "node.move",
      target: { kind: "node", mapSyncId: "map-1", syncId: "node-1" },
      payload: {
        mapSyncId: "map-1",
        nodeSyncId: "node-1",
        position: { x: 12, y: -4 }
      }
    }
  );
  assert.equal(createFastSharedChange("moveNode", { to: { x: 12, y: -4 } }), null);
  assert.equal(
    createFastSharedChange("moveNode", { to: { x: Number.NaN, y: -4 } }, identity),
    null
  );
  assert.equal(createFastSharedChange("createNode", {}, identity), null);
});

test("missing fast-path prerequisites explicitly fall back to workspace capture", () => {
  const fastChange = createFastSharedChange(
    "moveNode",
    { to: { x: 12, y: -4 } },
    { mapSyncId: "map-1", nodeSyncId: "node-1" }
  );

  assert.equal(requiresWorkspaceCapture("moveNode", fastChange), false);
  assert.equal(requiresWorkspaceCapture("moveNode", null), true);
  assert.equal(requiresWorkspaceCapture("updateViewFrame", null, []), false);
  assert.equal(requiresWorkspaceCapture("createNode", null), true);
  assert.equal(requiresWorkspaceCapture("updateViewFrame", null), true);
});
