import {
  rebuildChildrenByParentId,
  rebuildNodesById,
  unindexNodeById,
  unindexNodeByParentId
} from "./node-index.js";

export const BATCH_DELETE_MIN_NODE_COUNT = 128;

export function compactArrayInPlace(items, shouldKeep) {
  const originalLength = items.length;
  let writeIndex = 0;

  for (let readIndex = 0; readIndex < originalLength; readIndex += 1) {
    const item = items[readIndex];
    if (!shouldKeep(item)) continue;
    if (writeIndex !== readIndex) items[writeIndex] = item;
    writeIndex += 1;
  }

  items.length = writeIndex;
  return originalLength - writeIndex;
}

export function compactDeletedTreeInPlace({
  nodes,
  links,
  idsToDelete,
  nodesById,
  childrenByParentId
}) {
  const removedNodeCount = compactArrayInPlace(
    nodes,
    node => !idsToDelete.has(node.id)
  );
  const removedLinkCount = compactArrayInPlace(
    links,
    link => !idsToDelete.has(link.from) && !idsToDelete.has(link.to)
  );

  rebuildNodesById(nodes, nodesById);
  rebuildChildrenByParentId(nodes, childrenByParentId);

  return { removedNodeCount, removedLinkCount };
}

export function deleteTreeCollectionsInPlace({
  nodes,
  links,
  idsToDelete,
  nodesById,
  childrenByParentId,
  batchThreshold = BATCH_DELETE_MIN_NODE_COUNT
}) {
  if (idsToDelete.size >= batchThreshold) {
    return {
      strategy: "batch",
      ...compactDeletedTreeInPlace({
        nodes,
        links,
        idsToDelete,
        nodesById,
        childrenByParentId
      })
    };
  }

  let removedNodeCount = 0;
  let removedLinkCount = 0;

  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (!idsToDelete.has(nodes[index].id)) continue;
    unindexNodeByParentId(childrenByParentId, nodes[index]);
    unindexNodeById(nodesById, nodes[index]);
    nodes.splice(index, 1);
    removedNodeCount += 1;
  }

  for (let index = links.length - 1; index >= 0; index -= 1) {
    if (!idsToDelete.has(links[index].from) && !idsToDelete.has(links[index].to)) continue;
    links.splice(index, 1);
    removedLinkCount += 1;
  }

  return { strategy: "incremental", removedNodeCount, removedLinkCount };
}
