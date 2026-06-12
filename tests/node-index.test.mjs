import assert from "node:assert/strict";
import test from "node:test";

import {
  indexNodeById,
  inspectNodesById,
  rebuildNodesById,
  unindexNodeById
} from "../runtime/node-index.js";
import { baselineDrawLinks } from "../performance/baseline-algorithms.js";
import { createMentalMapDataset } from "../performance/dataset-generator.js";
import { indexedDrawLinks } from "../performance/indexed-algorithms.js";

test("nodesById rebuild and incremental updates preserve exact node references", () => {
  const nodes = [{ id: 1 }, { id: 2 }];
  const nodesById = rebuildNodesById(nodes);

  assert.equal(nodesById.get(2), nodes[1]);
  assert.equal(inspectNodesById(nodes, nodesById).valid, true);

  const created = { id: 3 };
  nodes.push(created);
  indexNodeById(nodesById, created);
  assert.equal(inspectNodesById(nodes, nodesById).valid, true);

  nodes.splice(1, 1);
  unindexNodeById(nodesById, nodesById.get(2));
  assert.equal(inspectNodesById(nodes, nodesById).valid, true);
});

test("nodesById detects duplicate, stale, missing, and mismatched entries", () => {
  const first = { id: 1 };
  const duplicate = { id: 1 };
  const nodes = [first, duplicate, { id: 2 }];
  const nodesById = rebuildNodesById(nodes);

  assert.deepEqual(inspectNodesById(nodes, nodesById).duplicateIds, [1]);
  assert.throws(() => indexNodeById(nodesById, duplicate), /Duplicate node id/);

  nodesById.delete(2);
  nodesById.set(3, { id: 3 });
  nodesById.set(1, duplicate);
  const inspection = inspectNodesById(nodes, nodesById);
  assert.deepEqual(inspection.missingIds, [2]);
  assert.deepEqual(inspection.staleIds, [3]);
  assert.deepEqual(inspection.mismatchedIds, [1]);
  assert.equal(inspection.valid, false);
});

test("indexed drawLinks preserves the baseline observable result", () => {
  const baselineDataset = createMentalMapDataset({ nodeCount: 100, shape: "balanced" });
  const indexedDataset = structuredClone(baselineDataset);
  const nodesById = rebuildNodesById(indexedDataset.nodes);

  assert.equal(
    indexedDrawLinks({ ...indexedDataset, nodesById }),
    baselineDrawLinks(baselineDataset)
  );
});
