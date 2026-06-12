import {
  getChildrenByParentId,
  rebuildChildrenByParentId,
  rebuildNodesById,
  unindexNodeById,
  unindexNodeByParentId
} from "../runtime/node-index.js";
import {
  compactDeletedTreeInPlace,
  deleteTreeCollectionsInPlace
} from "../runtime/batch-delete.js";
import {
  baselineDrawLinks,
  baselineGetDescendants
} from "./baseline-algorithms.js";

export function buildNodesById(nodes) {
  return rebuildNodesById(nodes);
}

export function indexedGetNodeById(nodesById, id) {
  return nodesById.get(id);
}

export function indexedDrawLinks({ nodesById, ...dataset }) {
  return baselineDrawLinks({
    ...dataset,
    getNodeById: id => nodesById.get(id)
  });
}

export function buildChildrenByParentId(nodes) {
  return rebuildChildrenByParentId(nodes);
}

export function indexedGetChildren(childrenByParentId, parentId) {
  return getChildrenByParentId(childrenByParentId, parentId);
}

export function indexedGetDescendants(childrenByParentId, nodeId) {
  const result = [];
  const stack = [nodeId];

  while (stack.length) {
    const current = stack.pop();
    const children = getChildrenByParentId(childrenByParentId, current);
    for (const child of children) {
      result.push(child.id);
      stack.push(child.id);
    }
  }

  return result;
}

function deleteTreeWithLookup({
  nodes,
  links,
  nodesById,
  childrenByParentId = null,
  rootNodeId,
  getDescendants
}) {
  const node = nodesById.get(rootNodeId);
  if (!node || node.isCenter) return 0;

  const descendants = getDescendants(node.id);
  const idsToDelete = new Set([node.id, ...descendants]);
  const deletedNodes = nodes.filter(existingNode => idsToDelete.has(existingNode.id));
  const deletedLinks = links.filter(link => idsToDelete.has(link.from) || idsToDelete.has(link.to));

  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (idsToDelete.has(nodes[index].id)) {
      if (childrenByParentId) unindexNodeByParentId(childrenByParentId, nodes[index]);
      unindexNodeById(nodesById, nodes[index]);
      nodes.splice(index, 1);
    }
  }
  for (let index = links.length - 1; index >= 0; index -= 1) {
    if (idsToDelete.has(links[index].from) || idsToDelete.has(links[index].to)) {
      links.splice(index, 1);
    }
  }

  nodesById.get(node.parentId);
  return deletedNodes.length + deletedLinks.length;
}

export function deleteTreeWithNodesById({ nodes, links, nodesById, rootNodeId }) {
  return deleteTreeWithLookup({
    nodes,
    links,
    nodesById,
    rootNodeId,
    getDescendants: id => baselineGetDescendants(nodes, id)
  });
}

export function indexedDeleteTree({
  nodes,
  links,
  nodesById,
  childrenByParentId,
  rootNodeId
}) {
  return deleteTreeWithLookup({
    nodes,
    links,
    nodesById,
    childrenByParentId,
    rootNodeId,
    getDescendants: id => indexedGetDescendants(childrenByParentId, id)
  });
}

function deleteTreeWithCollectionStrategy({
  nodes,
  links,
  nodesById,
  childrenByParentId,
  rootNodeId,
  deleteCollections
}) {
  const node = nodesById.get(rootNodeId);
  if (!node || node.isCenter) return 0;

  const descendants = indexedGetDescendants(childrenByParentId, node.id);
  const idsToDelete = new Set([node.id, ...descendants]);
  const deletedNodes = nodes.filter(existingNode => idsToDelete.has(existingNode.id));
  const deletedLinks = links.filter(link => idsToDelete.has(link.from) || idsToDelete.has(link.to));

  deleteCollections({
    nodes,
    links,
    idsToDelete,
    nodesById,
    childrenByParentId
  });

  nodesById.get(node.parentId);
  return deletedNodes.length + deletedLinks.length;
}

export function batchDeleteTree(options) {
  return deleteTreeWithCollectionStrategy({
    ...options,
    deleteCollections: compactDeletedTreeInPlace
  });
}

export function adaptiveDeleteTree(options) {
  return deleteTreeWithCollectionStrategy({
    ...options,
    deleteCollections: deleteTreeCollectionsInPlace
  });
}
