import assert from "node:assert/strict";
import test from "node:test";

import {
  BATCH_DELETE_MIN_NODE_COUNT,
  compactArrayInPlace,
  compactDeletedTreeInPlace,
  deleteTreeCollectionsInPlace
} from "../runtime/batch-delete.js";
import {
  inspectChildrenByParentId,
  inspectNodesById,
  rebuildChildrenByParentId,
  rebuildNodesById
} from "../runtime/node-index.js";
import { createMentalMapDataset } from "../performance/dataset-generator.js";
import {
  adaptiveDeleteTree,
  batchDeleteTree,
  indexedDeleteTree
} from "../performance/indexed-algorithms.js";

function indexedFixture(dataset) {
  const copy = structuredClone(dataset);
  return {
    ...copy,
    nodesById: rebuildNodesById(copy.nodes),
    childrenByParentId: rebuildChildrenByParentId(copy.nodes)
  };
}

test("compactArrayInPlace preserves array identity and survivor order", () => {
  const items = [1, 2, 3, 4, 5, 6];
  const original = items;
  const removed = compactArrayInPlace(items, value => value % 2 !== 0);

  assert.equal(items, original);
  assert.equal(removed, 3);
  assert.deepEqual(items, [1, 3, 5]);
});

test("batch deletion preserves node and link array identities and rebuilds indexes", () => {
  const dataset = createMentalMapDataset({ nodeCount: 85, shape: "balanced" });
  const fixture = indexedFixture(dataset);
  const originalNodes = fixture.nodes;
  const originalLinks = fixture.links;
  const idsToDelete = new Set([2, 6, 7, 8, 9]);

  compactDeletedTreeInPlace({ ...fixture, idsToDelete });

  assert.equal(fixture.nodes, originalNodes);
  assert.equal(fixture.links, originalLinks);
  assert.equal(inspectNodesById(fixture.nodes, fixture.nodesById).valid, true);
  assert.equal(inspectChildrenByParentId(fixture.nodes, fixture.childrenByParentId).valid, true);
  assert.ok(fixture.links.every(link => !idsToDelete.has(link.from) && !idsToDelete.has(link.to)));
});

test("batch deletion is behaviorally equivalent to PERF-002 deletion", () => {
  const dataset = createMentalMapDataset({ nodeCount: 341, shape: "balanced" });
  const previous = indexedFixture(dataset);
  const batched = indexedFixture(dataset);
  const adaptive = indexedFixture(dataset);

  const previousResult = indexedDeleteTree({ ...previous, rootNodeId: 2 });
  const batchedResult = batchDeleteTree({ ...batched, rootNodeId: 2 });
  const adaptiveResult = adaptiveDeleteTree({ ...adaptive, rootNodeId: 2 });

  assert.equal(batchedResult, previousResult);
  assert.equal(adaptiveResult, previousResult);
  assert.deepEqual(batched.nodes, previous.nodes);
  assert.deepEqual(batched.links, previous.links);
  assert.deepEqual(adaptive.nodes, previous.nodes);
  assert.deepEqual(adaptive.links, previous.links);
  assert.equal(inspectNodesById(batched.nodes, batched.nodesById).valid, true);
  assert.equal(inspectChildrenByParentId(batched.nodes, batched.childrenByParentId).valid, true);
  assert.equal(inspectNodesById(adaptive.nodes, adaptive.nodesById).valid, true);
  assert.equal(inspectChildrenByParentId(adaptive.nodes, adaptive.childrenByParentId).valid, true);
});

test("batch deletion preserves behavior with nodes outside parent-first order", () => {
  const nodes = [
    { id: 3, parentId: 2 },
    { id: 1, parentId: null, isCenter: true },
    { id: 2, parentId: 1 },
    { id: 4, parentId: 3 },
    { id: 5, parentId: 1 }
  ];
  const links = [
    { from: 1, to: 2 },
    { from: 2, to: 3 },
    { from: 3, to: 4 },
    { from: 1, to: 5 }
  ];
  const nodesById = rebuildNodesById(nodes);
  const childrenByParentId = rebuildChildrenByParentId(nodes);

  batchDeleteTree({ nodes, links, nodesById, childrenByParentId, rootNodeId: 2 });

  assert.deepEqual(nodes.map(node => node.id), [1, 5]);
  assert.deepEqual(links, [{ from: 1, to: 5 }]);
  assert.equal(inspectNodesById(nodes, nodesById).valid, true);
  assert.equal(inspectChildrenByParentId(nodes, childrenByParentId).valid, true);
});

test("adaptive deletion uses incremental and batch strategies across the threshold", () => {
  const incremental = indexedFixture(
    createMentalMapDataset({ nodeCount: BATCH_DELETE_MIN_NODE_COUNT + 10, shape: "star" })
  );
  const batch = indexedFixture(
    createMentalMapDataset({ nodeCount: BATCH_DELETE_MIN_NODE_COUNT + 10, shape: "deep" })
  );

  const incrementalResult = deleteTreeCollectionsInPlace({
    ...incremental,
    idsToDelete: new Set([incremental.nodes.at(-1).id])
  });
  const batchIds = new Set(batch.nodes.slice(1).map(node => node.id));
  const batchResult = deleteTreeCollectionsInPlace({ ...batch, idsToDelete: batchIds });

  assert.equal(incrementalResult.strategy, "incremental");
  assert.equal(batchResult.strategy, "batch");
  assert.equal(inspectNodesById(incremental.nodes, incremental.nodesById).valid, true);
  assert.equal(inspectChildrenByParentId(incremental.nodes, incremental.childrenByParentId).valid, true);
  assert.equal(inspectNodesById(batch.nodes, batch.nodesById).valid, true);
  assert.equal(inspectChildrenByParentId(batch.nodes, batch.childrenByParentId).valid, true);
});
