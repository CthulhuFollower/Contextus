import assert from "node:assert/strict";
import test from "node:test";

import {
  getChildrenByParentId,
  indexNodeByParentId,
  inspectChildrenByParentId,
  rebuildChildrenByParentId,
  rebuildNodesById,
  unindexNodeByParentId
} from "../runtime/node-index.js";
import {
  baselineGetChildren,
  baselineGetDescendants
} from "../performance/baseline-algorithms.js";
import { createMentalMapDataset } from "../performance/dataset-generator.js";
import {
  indexedDeleteTree,
  indexedGetDescendants
} from "../performance/indexed-algorithms.js";

test("childrenByParentId rebuild preserves filter order and root membership", () => {
  const nodes = [
    { id: 1, parentId: null },
    { id: 2, parentId: 1 },
    { id: 3, parentId: 1 },
    { id: 4, parentId: 2 }
  ];
  const childrenByParentId = rebuildChildrenByParentId(nodes);

  assert.deepEqual(getChildrenByParentId(childrenByParentId, null), [nodes[0]]);
  assert.deepEqual(getChildrenByParentId(childrenByParentId, 1), baselineGetChildren(nodes, 1));
  assert.deepEqual(getChildrenByParentId(childrenByParentId, 999), []);
  assert.equal(inspectChildrenByParentId(nodes, childrenByParentId).valid, true);
});

test("childrenByParentId incremental updates remain equivalent to rebuild", () => {
  const nodes = [{ id: 1, parentId: null }, { id: 2, parentId: 1 }];
  const childrenByParentId = rebuildChildrenByParentId(nodes);
  const created = { id: 3, parentId: 1 };

  nodes.push(created);
  indexNodeByParentId(childrenByParentId, created);
  assert.equal(inspectChildrenByParentId(nodes, childrenByParentId).valid, true);

  unindexNodeByParentId(childrenByParentId, nodes[1]);
  nodes.splice(1, 1);
  assert.equal(inspectChildrenByParentId(nodes, childrenByParentId).valid, true);
});

test("childrenByParentId inspection detects missing, stale, and reordered buckets", () => {
  const dataset = createMentalMapDataset({ nodeCount: 21, shape: "balanced" });
  const childrenByParentId = rebuildChildrenByParentId(dataset.nodes);

  childrenByParentId.delete(2);
  childrenByParentId.set(999, []);
  childrenByParentId.get(1).reverse();
  const inspection = inspectChildrenByParentId(dataset.nodes, childrenByParentId);

  assert.deepEqual(inspection.missingParentIds, [2]);
  assert.deepEqual(inspection.staleParentIds, [999]);
  assert.deepEqual(inspection.mismatchedParentIds, [1]);
  assert.equal(inspection.valid, false);
});

test("indexed descendants and deletion preserve baseline behavior and indexes", () => {
  const baselineDataset = createMentalMapDataset({ nodeCount: 85, shape: "balanced" });
  const indexedDataset = structuredClone(baselineDataset);
  const nodesById = rebuildNodesById(indexedDataset.nodes);
  const childrenByParentId = rebuildChildrenByParentId(indexedDataset.nodes);

  assert.deepEqual(
    indexedGetDescendants(childrenByParentId, 2),
    baselineGetDescendants(baselineDataset.nodes, 2)
  );

  indexedDeleteTree({
    ...indexedDataset,
    nodesById,
    childrenByParentId,
    rootNodeId: 2
  });

  assert.equal(nodesById.size, indexedDataset.nodes.length);
  assert.equal(inspectChildrenByParentId(indexedDataset.nodes, childrenByParentId).valid, true);
});

test("indexed deletion cleans buckets even when nodes are not parent-first", () => {
  const nodes = [
    { id: 3, parentId: 2 },
    { id: 1, parentId: null, isCenter: true },
    { id: 2, parentId: 1 },
    { id: 4, parentId: 3 }
  ];
  const links = [
    { from: 1, to: 2 },
    { from: 2, to: 3 },
    { from: 3, to: 4 }
  ];
  const nodesById = rebuildNodesById(nodes);
  const childrenByParentId = rebuildChildrenByParentId(nodes);

  indexedDeleteTree({ nodes, links, nodesById, childrenByParentId, rootNodeId: 2 });

  assert.deepEqual(nodes.map(node => node.id), [1]);
  assert.equal(links.length, 0);
  assert.equal(inspectChildrenByParentId(nodes, childrenByParentId).valid, true);
});
