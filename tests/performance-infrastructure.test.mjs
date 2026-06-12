import assert from "node:assert/strict";
import test from "node:test";

import {
  baselineDeleteTree,
  baselineDrawLinks,
  baselineGetChildren,
  baselineGetDescendants,
  baselineGetMapById,
  baselineGetNodeById,
  estimateDrawLinkFindComparisons
} from "../performance/baseline-algorithms.js";
import {
  countSubtreeNodes,
  createMapList,
  createMentalMapDataset
} from "../performance/dataset-generator.js";

test("performance datasets are deterministic and preserve tree relationships", () => {
  const first = createMentalMapDataset({ nodeCount: 100, shape: "mixed", noteSize: 20 });
  const second = createMentalMapDataset({ nodeCount: 100, shape: "mixed", noteSize: 20 });

  assert.deepEqual(first, second);
  assert.equal(first.nodes.length, 100);
  assert.equal(first.links.length, 99);
  for (const node of first.nodes.slice(1)) {
    assert.ok(node.parentId < node.id);
    assert.equal(node.parentSyncId, `node_1_${node.parentId}`);
  }
});

test("baseline lookup and traversal preserve current array-based behavior", () => {
  const { nodes } = createMentalMapDataset({ nodeCount: 21, shape: "balanced", branchingFactor: 4 });

  assert.equal(baselineGetNodeById(nodes, 21).id, 21);
  assert.equal(baselineGetNodeById(nodes, -1), undefined);
  assert.deepEqual(baselineGetChildren(nodes, 1).map(node => node.id), [2, 3, 4, 5]);
  assert.equal(baselineGetDescendants(nodes, 1).length, 20);
  assert.equal(countSubtreeNodes(nodes, 2), 5);
});

test("baseline map lookup, drawing, and deletion produce observable results", () => {
  const maps = createMapList(10);
  const dataset = createMentalMapDataset({ nodeCount: 21, shape: "balanced", branchingFactor: 4 });
  const expectedComparisons = dataset.links.reduce((sum, link) => sum + link.from + link.to, 0);

  assert.equal(baselineGetMapById(maps, 10).id, 10);
  assert.equal(estimateDrawLinkFindComparisons(dataset.links), expectedComparisons);
  assert.ok(baselineDrawLinks(dataset) > 0);
  assert.equal(baselineDeleteTree(dataset.nodes, dataset.links, 2), 10);
  assert.equal(dataset.nodes.length, 16);
  assert.equal(dataset.links.length, 15);
});
