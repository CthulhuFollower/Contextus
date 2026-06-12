export function rebuildNodesById(nodes, nodesById = new Map()) {
  nodesById.clear();

  for (const node of nodes) {
    // Preserve the previous Array.find behavior if legacy data contains duplicates.
    if (!nodesById.has(node.id)) nodesById.set(node.id, node);
  }

  return nodesById;
}

export function indexNodeById(nodesById, node) {
  const existing = nodesById.get(node.id);
  if (existing && existing !== node) {
    throw new Error(`Duplicate node id: ${node.id}`);
  }

  nodesById.set(node.id, node);
  return node;
}

export function unindexNodeById(nodesById, node) {
  if (nodesById.get(node.id) === node) {
    nodesById.delete(node.id);
    return true;
  }

  return false;
}

export function inspectNodesById(nodes, nodesById) {
  const expected = new Map();
  const duplicateIds = [];

  for (const node of nodes) {
    if (expected.has(node.id)) duplicateIds.push(node.id);
    else expected.set(node.id, node);
  }

  const missingIds = [];
  const staleIds = [];
  const mismatchedIds = [];

  for (const [id, node] of expected) {
    if (!nodesById.has(id)) missingIds.push(id);
    else if (nodesById.get(id) !== node) mismatchedIds.push(id);
  }

  for (const id of nodesById.keys()) {
    if (!expected.has(id)) staleIds.push(id);
  }

  return {
    valid:
      duplicateIds.length === 0 &&
      missingIds.length === 0 &&
      staleIds.length === 0 &&
      mismatchedIds.length === 0 &&
      nodesById.size === expected.size,
    duplicateIds,
    missingIds,
    staleIds,
    mismatchedIds,
    expectedSize: expected.size,
    actualSize: nodesById.size
  };
}

const EMPTY_CHILDREN = Object.freeze([]);

export function rebuildChildrenByParentId(nodes, childrenByParentId = new Map()) {
  childrenByParentId.clear();

  for (const node of nodes) {
    indexNodeByParentId(childrenByParentId, node);
  }

  return childrenByParentId;
}

export function indexNodeByParentId(childrenByParentId, node) {
  const children = childrenByParentId.get(node.parentId);
  if (children) children.push(node);
  else childrenByParentId.set(node.parentId, [node]);
  return node;
}

export function unindexNodeByParentId(childrenByParentId, node) {
  const children = childrenByParentId.get(node.parentId);
  if (!children) return false;

  const index = children.indexOf(node);
  if (index < 0) return false;

  children.splice(index, 1);
  if (!children.length) childrenByParentId.delete(node.parentId);
  return true;
}

export function getChildrenByParentId(childrenByParentId, parentId) {
  return childrenByParentId.get(parentId) || EMPTY_CHILDREN;
}

export function inspectChildrenByParentId(nodes, childrenByParentId) {
  const expected = rebuildChildrenByParentId(nodes);
  const missingParentIds = [];
  const staleParentIds = [];
  const mismatchedParentIds = [];

  for (const [parentId, expectedChildren] of expected) {
    const actualChildren = childrenByParentId.get(parentId);
    if (!actualChildren) {
      missingParentIds.push(parentId);
      continue;
    }

    if (
      actualChildren.length !== expectedChildren.length ||
      actualChildren.some((node, index) => node !== expectedChildren[index])
    ) {
      mismatchedParentIds.push(parentId);
    }
  }

  for (const parentId of childrenByParentId.keys()) {
    if (!expected.has(parentId)) staleParentIds.push(parentId);
  }

  return {
    valid:
      missingParentIds.length === 0 &&
      staleParentIds.length === 0 &&
      mismatchedParentIds.length === 0 &&
      childrenByParentId.size === expected.size,
    missingParentIds,
    staleParentIds,
    mismatchedParentIds,
    expectedSize: expected.size,
    actualSize: childrenByParentId.size
  };
}
