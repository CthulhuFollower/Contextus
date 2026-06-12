import {
  cloneValue,
  createEmptySharedSnapshot,
  createSyncId
} from "./workspace-model.js";

export const SHARED_OPERATION_TYPES = new Set([
  "map.create",
  "map.delete",
  "map.move",
  "node.create",
  "node.edit",
  "node.move",
  "node.deleteTree",
  "conflict.resolve"
]);

function vectorHasSeen(vector, version) {
  if (!version) return false;
  return (vector?.[version.deviceId] || 0) >= version.sequence;
}

export function versionsAreConcurrent(left, right) {
  if (!left || !right) return false;
  if (left.deviceId === right.deviceId) return false;
  return !vectorHasSeen(left.context, right) && !vectorHasSeen(right.context, left);
}

export function compareVersions(left, right) {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;

  if (vectorHasSeen(left.context, right)) return 1;
  if (vectorHasSeen(right.context, left)) return -1;

  const leftClock = left.clock || {};
  const rightClock = right.clock || {};
  if ((leftClock.wallTime || 0) !== (rightClock.wallTime || 0)) {
    return (leftClock.wallTime || 0) - (rightClock.wallTime || 0);
  }
  if ((leftClock.counter || 0) !== (rightClock.counter || 0)) {
    return (leftClock.counter || 0) - (rightClock.counter || 0);
  }
  return String(left.deviceId || "").localeCompare(String(right.deviceId || ""));
}

function operationVersion(operation) {
  return {
    operationId: operation.operationId,
    deviceId: operation.deviceId,
    sequence: operation.sequence,
    context: cloneValue(operation.context || {}),
    clock: cloneValue(operation.clock)
  };
}

function compareOperations(left, right) {
  return compareVersions(operationVersion(left), operationVersion(right));
}

function findMap(snapshot, syncId) {
  return snapshot.maps.find(map => map.syncId === syncId) || null;
}

function findNode(map, syncId) {
  return map?.nodes?.find(node => node.syncId === syncId) || null;
}

function findTombstone(snapshot, kind, syncId) {
  return snapshot.tombstones.find(item => item.kind === kind && item.syncId === syncId) || null;
}

function upsertById(items, item, key = "id") {
  const index = items.findIndex(existing => existing[key] === item[key]);
  if (index >= 0) items[index] = item;
  else items.push(item);
}

function addRecovery(snapshot, kind, targetSyncId, data, operation, reason, relatedVersion = null) {
  const operationIds = [
    operation.operationId,
    relatedVersion?.operationId
  ].filter(Boolean).sort();
  const id = `recovery_${kind}_${targetSyncId}_${operationIds.join("_")}`;
  upsertById(snapshot.recoveries, {
    id,
    kind,
    targetSyncId,
    reason: "work-concurrent-with-delete",
    operationIds,
    createdAt: Math.max(
      operation.clock?.wallTime || 0,
      relatedVersion?.clock?.wallTime || 0
    ),
    data: cloneValue(data)
  });
}

function addConflict(snapshot, conflict) {
  upsertById(snapshot.conflicts, conflict);
}

function fieldConflictId(kind, syncId, field, leftVersion, rightVersion) {
  const ids = [leftVersion?.operationId || "baseline", rightVersion?.operationId || "baseline"].sort();
  return `conflict_${kind}_${syncId}_${field}_${ids.join("_")}`;
}

function applyField(snapshot, entity, field, value, incomingVersion, options = {}) {
  entity.versions ||= {};
  const existingVersion = entity.versions[field] || null;
  const comparison = compareVersions(incomingVersion, existingVersion);
  const concurrent = versionsAreConcurrent(incomingVersion, existingVersion);

  if (concurrent && options.manualConflict && entity[field] !== value) {
    const winnerIncoming = comparison >= 0;
    const variants = [
      { value: cloneValue(entity[field]), version: cloneValue(existingVersion) },
      { value: cloneValue(value), version: cloneValue(incomingVersion) }
    ].sort((left, right) =>
      String(left.version?.operationId || "").localeCompare(String(right.version?.operationId || ""))
    );
    addConflict(snapshot, {
      id: fieldConflictId(options.kind, entity.syncId, field, existingVersion, incomingVersion),
      type: "field",
      kind: options.kind,
      targetSyncId: entity.syncId,
      mapSyncId: options.mapSyncId || null,
      field,
      variants,
      provisionalValue: cloneValue(winnerIncoming ? value : entity[field]),
      createdAt: Math.max(
        existingVersion?.clock?.wallTime || 0,
        incomingVersion?.clock?.wallTime || 0
      )
    });
  }

  if (comparison >= 0) {
    entity[field] = cloneValue(value);
    entity.versions[field] = cloneValue(incomingVersion);
  }
}

function latestEntityVersions(entity) {
  return Object.values(entity?.versions || {}).filter(Boolean);
}

function hasConcurrentEntityWork(entity, deleteVersion) {
  return latestEntityVersions(entity).some(version => versionsAreConcurrent(version, deleteVersion));
}

function latestConcurrentEntityVersion(entity, deleteVersion) {
  const versions = latestEntityVersions(entity)
    .filter(version => versionsAreConcurrent(version, deleteVersion))
    .sort(compareVersions);
  return versions[versions.length - 1] || null;
}

function putTombstone(snapshot, tombstone) {
  const existing = findTombstone(snapshot, tombstone.kind, tombstone.syncId);
  if (!existing || compareVersions(tombstone.version, existing.version) >= 0) {
    if (existing) Object.assign(existing, cloneValue(tombstone));
    else snapshot.tombstones.push(cloneValue(tombstone));
  }
}

function ensureNonEmptyUniverse(snapshot, operation) {
  if (snapshot.maps.length) return;

  const candidates = snapshot.tombstones
    .filter(item => item.kind === "map" && item.data)
    .sort((a, b) => String(a.syncId).localeCompare(String(b.syncId)));
  const survivor = candidates[0];
  if (!survivor) return;

  survivor.protected = true;
  snapshot.maps.push(cloneValue(survivor.data));
  addConflict(snapshot, {
    id: `conflict_universe_empty_${survivor.syncId}`,
    type: "universe.empty",
    kind: "map",
    targetSyncId: survivor.syncId,
    provisionalValue: survivor.syncId,
    createdAt: operation?.clock?.wallTime || Date.now()
  });
}

function applyMapCreate(snapshot, operation, version) {
  const incoming = cloneValue(operation.payload.map);
  if (!incoming?.syncId) return;
  incoming.versions ||= {};
  incoming.versions.create = cloneValue(version);
  incoming.versions.constellationPosition ||= cloneValue(version);
  for (const node of incoming.nodes || []) {
    node.versions ||= {};
    node.versions.create = cloneValue(version);
    node.versions.label ||= cloneValue(version);
    node.versions.note ||= cloneValue(version);
    node.versions.position ||= cloneValue(version);
    node.versions.parent ||= cloneValue(version);
  }

  const tombstone = findTombstone(snapshot, "map", incoming.syncId);
  if (tombstone) {
    if (versionsAreConcurrent(tombstone.version, version)) {
      addRecovery(snapshot, "map", incoming.syncId, incoming, operation, "create-concurrent-with-delete", tombstone.version);
    }
    return;
  }

  if (findMap(snapshot, incoming.syncId)) return;
  snapshot.maps.push(incoming);
}

function applyMapDelete(snapshot, operation, version) {
  const mapSyncId = operation.target?.syncId || operation.payload.mapSyncId;
  const map = findMap(snapshot, mapSyncId);
  if (!map) return;

  const concurrentMapVersion = latestConcurrentEntityVersion(map, version);
  if (concurrentMapVersion) {
    addRecovery(snapshot, "map", mapSyncId, map, operation, "map-delete-concurrent-with-work", concurrentMapVersion);
  }
  for (const node of map.nodes || []) {
    const concurrentNodeVersion = latestConcurrentEntityVersion(node, version);
    if (concurrentNodeVersion) {
      addRecovery(snapshot, "node", node.syncId, node, operation, "map-delete-concurrent-with-node-work", concurrentNodeVersion);
    }
    putTombstone(snapshot, {
      kind: "node",
      syncId: node.syncId,
      mapSyncId,
      version,
      data: node
    });
  }

  snapshot.maps = snapshot.maps.filter(item => item.syncId !== mapSyncId);
  putTombstone(snapshot, {
    kind: "map",
    syncId: mapSyncId,
    version,
    data: map
  });
  ensureNonEmptyUniverse(snapshot, operation);
}

function applyMapMove(snapshot, operation, version) {
  const mapSyncId = operation.target?.syncId || operation.payload.mapSyncId;
  const map = findMap(snapshot, mapSyncId);
  if (!map) {
    const tombstone = findTombstone(snapshot, "map", mapSyncId);
    if (tombstone && versionsAreConcurrent(tombstone.version, version)) {
      const recovered = cloneValue(tombstone.data || {});
      recovered.constellationPosition = cloneValue(operation.payload.position);
      recovered.versions ||= {};
      recovered.versions.constellationPosition = cloneValue(version);
      addRecovery(snapshot, "map", mapSyncId, recovered, operation, "move-concurrent-with-delete", tombstone.version);
    }
    return;
  }
  applyField(snapshot, map, "constellationPosition", operation.payload.position, version, {
    kind: "map"
  });
}

function applyNodeCreate(snapshot, operation, version) {
  const mapSyncId = operation.target?.mapSyncId || operation.payload.mapSyncId;
  const map = findMap(snapshot, mapSyncId);
  const incoming = cloneValue(operation.payload.node);
  if (!incoming?.syncId) return;
  incoming.versions ||= {};
  incoming.versions.create = cloneValue(version);
  incoming.versions.label ||= cloneValue(version);
  incoming.versions.note ||= cloneValue(version);
  incoming.versions.position ||= cloneValue(version);
  incoming.versions.parent ||= cloneValue(version);
  if (!map) {
    const mapTombstone = findTombstone(snapshot, "map", mapSyncId);
    if (mapTombstone && versionsAreConcurrent(mapTombstone.version, version)) {
      addRecovery(snapshot, "node", incoming.syncId, incoming, operation, "create-inside-deleted-map", mapTombstone.version);
    }
    return;
  }

  const parentTombstone = incoming.parentSyncId
    ? findTombstone(snapshot, "node", incoming.parentSyncId)
    : null;
  if (parentTombstone) {
    if (versionsAreConcurrent(parentTombstone.version, version)) {
      addRecovery(snapshot, "node", incoming.syncId, incoming, operation, "create-under-deleted-parent", parentTombstone.version);
    }
    return;
  }

  const tombstone = findTombstone(snapshot, "node", incoming.syncId);
  if (tombstone) {
    if (versionsAreConcurrent(tombstone.version, version)) {
      addRecovery(snapshot, "node", incoming.syncId, incoming, operation, "create-concurrent-with-delete", tombstone.version);
    }
    return;
  }

  if (findNode(map, incoming.syncId)) return;
  map.nodes.push(incoming);
}

function applyNodeEdit(snapshot, operation, version) {
  const map = findMap(snapshot, operation.target?.mapSyncId || operation.payload.mapSyncId);
  const nodeSyncId = operation.target?.syncId || operation.payload.nodeSyncId;
  const node = findNode(map, nodeSyncId);

  if (!node) {
    const tombstone = findTombstone(snapshot, "node", nodeSyncId);
    if (tombstone && versionsAreConcurrent(tombstone.version, version)) {
      const recovered = cloneValue(tombstone.data || { syncId: nodeSyncId });
      recovered.versions ||= {};
      for (const [field, value] of Object.entries(operation.payload.changes || {})) {
        recovered[field] = cloneValue(value);
        recovered.versions[field] = cloneValue(version);
      }
      addRecovery(snapshot, "node", nodeSyncId, recovered, operation, "edit-concurrent-with-delete", tombstone.version);
    }
    return;
  }

  for (const field of ["label", "note"]) {
    if (!Object.prototype.hasOwnProperty.call(operation.payload.changes || {}, field)) continue;
    applyField(snapshot, node, field, operation.payload.changes[field], version, {
      kind: "node",
      mapSyncId: map.syncId,
      manualConflict: true
    });
  }
}

function applyNodeMove(snapshot, operation, version) {
  const map = findMap(snapshot, operation.target?.mapSyncId || operation.payload.mapSyncId);
  const nodeSyncId = operation.target?.syncId || operation.payload.nodeSyncId;
  const node = findNode(map, nodeSyncId);

  if (!node) {
    const tombstone = findTombstone(snapshot, "node", nodeSyncId);
    if (tombstone && versionsAreConcurrent(tombstone.version, version)) {
      const recovered = cloneValue(tombstone.data || { syncId: nodeSyncId });
      recovered.x = Number(operation.payload.position?.x) || 0;
      recovered.y = Number(operation.payload.position?.y) || 0;
      recovered.versions ||= {};
      recovered.versions.position = cloneValue(version);
      addRecovery(snapshot, "node", nodeSyncId, recovered, operation, "move-concurrent-with-delete", tombstone.version);
    }
    return;
  }

  const position = operation.payload.position || {};
  const incoming = { x: Number(position.x) || 0, y: Number(position.y) || 0 };
  node.versions ||= {};
  if (compareVersions(version, node.versions.position) >= 0) {
    node.x = incoming.x;
    node.y = incoming.y;
    node.versions.position = cloneValue(version);
  }
}

function collectNodeTree(map, roots) {
  const ids = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of map.nodes) {
      if (node.parentSyncId && ids.has(node.parentSyncId) && !ids.has(node.syncId)) {
        ids.add(node.syncId);
        changed = true;
      }
    }
  }
  return ids;
}

function applyNodeDeleteTree(snapshot, operation, version) {
  const map = findMap(snapshot, operation.target?.mapSyncId || operation.payload.mapSyncId);
  if (!map) return;

  const requested = operation.payload.nodeSyncIds || [operation.target?.syncId].filter(Boolean);
  const ids = collectNodeTree(map, requested);
  const deleted = map.nodes.filter(node => ids.has(node.syncId));

  for (const node of deleted) {
    const concurrentVersion = latestConcurrentEntityVersion(node, version);
    if (concurrentVersion) {
      addRecovery(snapshot, "node", node.syncId, node, operation, "node-delete-concurrent-with-work", concurrentVersion);
    }
    putTombstone(snapshot, {
      kind: "node",
      syncId: node.syncId,
      mapSyncId: map.syncId,
      version,
      data: node
    });
  }

  map.nodes = map.nodes.filter(node => !ids.has(node.syncId));
}

function applyConflictResolve(snapshot, operation, version) {
  const conflict = snapshot.conflicts.find(item => item.id === operation.payload.conflictId);
  if (!conflict || conflict.type !== "field") return;

  const map = conflict.kind === "map"
    ? findMap(snapshot, conflict.targetSyncId)
    : findMap(snapshot, conflict.mapSyncId);
  const entity = conflict.kind === "map" ? map : findNode(map, conflict.targetSyncId);
  if (!entity) return;

  applyField(snapshot, entity, conflict.field, operation.payload.value, version, {
    kind: conflict.kind,
    mapSyncId: conflict.mapSyncId
  });
  snapshot.conflicts = snapshot.conflicts.filter(item => item.id !== conflict.id);
  snapshot.resolvedConflicts ||= [];
  upsertById(snapshot.resolvedConflicts, {
    id: conflict.id,
    value: cloneValue(operation.payload.value),
    version: cloneValue(version),
    resolvedAt: operation.clock?.wallTime || Date.now()
  });
}

export function applyOperationMutable(sharedSnapshot, operation) {
  if (!SHARED_OPERATION_TYPES.has(operation?.type)) {
    throw new Error(`Tipo de operacion compartida desconocido: ${operation?.type}`);
  }

  const snapshot = sharedSnapshot || createEmptySharedSnapshot(operation.workspaceId);
  if (snapshot.workspaceId !== operation.workspaceId) {
    throw new Error("La operacion pertenece a otro universo.");
  }

  const knownSequence = snapshot.vector?.[operation.deviceId] || 0;
  if (knownSequence >= operation.sequence) return snapshot;

  const version = operationVersion(operation);
  if (operation.type === "map.create") applyMapCreate(snapshot, operation, version);
  if (operation.type === "map.delete") applyMapDelete(snapshot, operation, version);
  if (operation.type === "map.move") applyMapMove(snapshot, operation, version);
  if (operation.type === "node.create") applyNodeCreate(snapshot, operation, version);
  if (operation.type === "node.edit") applyNodeEdit(snapshot, operation, version);
  if (operation.type === "node.move") applyNodeMove(snapshot, operation, version);
  if (operation.type === "node.deleteTree") applyNodeDeleteTree(snapshot, operation, version);
  if (operation.type === "conflict.resolve") applyConflictResolve(snapshot, operation, version);

  snapshot.vector ||= {};
  snapshot.vector[operation.deviceId] = Math.max(knownSequence, operation.sequence);
  snapshot.savedAt = Math.max(
    Number(snapshot.savedAt) || 0,
    Number(operation.clock?.wallTime) || 0
  );
  return snapshot;
}

export function applyOperation(sharedSnapshot, operation) {
  return applyOperationMutable(
    sharedSnapshot ? cloneValue(sharedSnapshot) : null,
    operation
  );
}

function mergeFieldInto(snapshot, target, source, field, options) {
  const sourceVersion = source.versions?.[field] || null;
  if (!sourceVersion && target[field] !== undefined) return;
  applyField(snapshot, target, field, source[field], sourceVersion, options);
}

function mergeNode(snapshot, localNode, remoteNode, mapSyncId) {
  const merged = cloneValue(localNode);
  merged.versions ||= {};
  for (const field of ["label", "note"]) {
    mergeFieldInto(snapshot, merged, remoteNode, field, {
      kind: "node",
      mapSyncId,
      manualConflict: true
    });
  }

  const remotePositionVersion = remoteNode.versions?.position || null;
  if (compareVersions(remotePositionVersion, merged.versions.position) >= 0) {
    merged.x = remoteNode.x;
    merged.y = remoteNode.y;
    merged.versions.position = cloneValue(remotePositionVersion);
  }
  if (compareVersions(remoteNode.versions?.parent, merged.versions.parent) >= 0) {
    merged.parentSyncId = remoteNode.parentSyncId || null;
    merged.level = remoteNode.level;
    merged.versions.parent = cloneValue(remoteNode.versions?.parent || null);
  }
  if (compareVersions(remoteNode.versions?.create, merged.versions.create) >= 0) {
    merged.versions.create = cloneValue(remoteNode.versions?.create || null);
  }
  return merged;
}

function mergeMap(snapshot, localMap, remoteMap) {
  const merged = cloneValue(localMap);
  merged.versions ||= {};
  mergeFieldInto(snapshot, merged, remoteMap, "constellationPosition", { kind: "map" });
  if (compareVersions(remoteMap.versions?.create, merged.versions.create) >= 0) {
    merged.versions.create = cloneValue(remoteMap.versions?.create || null);
  }

  const nodes = new Map((merged.nodes || []).map(node => [node.syncId, node]));
  for (const remoteNode of remoteMap.nodes || []) {
    const localNode = nodes.get(remoteNode.syncId);
    nodes.set(
      remoteNode.syncId,
      localNode ? mergeNode(snapshot, localNode, remoteNode, merged.syncId) : cloneValue(remoteNode)
    );
  }
  merged.nodes = [...nodes.values()];
  return merged;
}

function mergeUniqueRecords(local, remote) {
  const result = new Map();
  for (const item of [...(local || []), ...(remote || [])]) {
    const existing = result.get(item.id);
    if (!existing || (item.createdAt || 0) >= (existing.createdAt || 0)) {
      result.set(item.id, cloneValue(item));
    }
  }
  return [...result.values()];
}

function applyMergedTombstones(snapshot) {
  for (const tombstone of snapshot.tombstones) {
    if (tombstone.kind === "map") {
      const map = findMap(snapshot, tombstone.syncId);
      if (!map) continue;
      if (tombstone.protected) continue;
      if (hasConcurrentEntityWork(map, tombstone.version)) {
        const synthetic = {
          operationId: tombstone.version?.operationId || createSyncId("snapshot-delete"),
          clock: tombstone.version?.clock
        };
        addRecovery(
          snapshot,
          "map",
          map.syncId,
          map,
          synthetic,
          "snapshot-delete-concurrent-with-work",
          latestConcurrentEntityVersion(map, tombstone.version)
        );
      }
      snapshot.maps = snapshot.maps.filter(item => item.syncId !== map.syncId);
      continue;
    }

    const map = findMap(snapshot, tombstone.mapSyncId);
    const node = findNode(map, tombstone.syncId);
    if (!map || !node) continue;
    if (findTombstone(snapshot, "map", tombstone.mapSyncId)?.protected) continue;
    if (hasConcurrentEntityWork(node, tombstone.version)) {
      const synthetic = {
        operationId: tombstone.version?.operationId || createSyncId("snapshot-delete"),
        clock: tombstone.version?.clock
      };
      addRecovery(
        snapshot,
        "node",
        node.syncId,
        node,
        synthetic,
        "snapshot-delete-concurrent-with-work",
        latestConcurrentEntityVersion(node, tombstone.version)
      );
    }
    map.nodes = map.nodes.filter(item => item.syncId !== node.syncId);
  }
  ensureNonEmptyUniverse(snapshot);
}

export function mergeSharedSnapshots(localSnapshot, remoteSnapshot) {
  if (!localSnapshot) return cloneValue(remoteSnapshot);
  if (!remoteSnapshot) return cloneValue(localSnapshot);
  if (localSnapshot.workspaceId !== remoteSnapshot.workspaceId) {
    throw new Error("No se pueden mezclar universos distintos.");
  }

  const merged = cloneValue(localSnapshot);
  merged.conflicts = mergeUniqueRecords(localSnapshot.conflicts, remoteSnapshot.conflicts);
  const resolvedConflicts = new Map();
  for (const resolution of [
    ...(localSnapshot.resolvedConflicts || []),
    ...(remoteSnapshot.resolvedConflicts || [])
  ]) {
    const existing = resolvedConflicts.get(resolution.id);
    if (!existing || compareVersions(resolution.version, existing.version) >= 0) {
      resolvedConflicts.set(resolution.id, cloneValue(resolution));
    }
  }
  merged.resolvedConflicts = [...resolvedConflicts.values()];
  merged.conflicts = merged.conflicts.filter(conflict => !resolvedConflicts.has(conflict.id));
  merged.recoveries = mergeUniqueRecords(localSnapshot.recoveries, remoteSnapshot.recoveries);

  const tombstones = new Map();
  for (const tombstone of [...(localSnapshot.tombstones || []), ...(remoteSnapshot.tombstones || [])]) {
    const key = `${tombstone.kind}:${tombstone.syncId}`;
    const existing = tombstones.get(key);
    if (!existing || compareVersions(tombstone.version, existing.version) > 0) {
      tombstones.set(key, cloneValue(tombstone));
    } else if (compareVersions(tombstone.version, existing.version) === 0) {
      const mergedTombstone = cloneValue(existing);
      mergedTombstone.protected = Boolean(existing.protected || tombstone.protected);
      tombstones.set(key, mergedTombstone);
    }
  }
  merged.tombstones = [...tombstones.values()];

  const maps = new Map((merged.maps || []).map(map => [map.syncId, map]));
  for (const remoteMap of remoteSnapshot.maps || []) {
    const localMap = maps.get(remoteMap.syncId);
    maps.set(remoteMap.syncId, localMap ? mergeMap(merged, localMap, remoteMap) : cloneValue(remoteMap));
  }
  merged.maps = [...maps.values()];
  merged.conflicts = merged.conflicts.filter(conflict => !resolvedConflicts.has(conflict.id));

  merged.vector ||= {};
  for (const [deviceId, sequence] of Object.entries(remoteSnapshot.vector || {})) {
    merged.vector[deviceId] = Math.max(merged.vector[deviceId] || 0, sequence);
  }
  merged.compactedVector ||= {};
  for (const [deviceId, sequence] of Object.entries(remoteSnapshot.compactedVector || {})) {
    merged.compactedVector[deviceId] = Math.max(merged.compactedVector[deviceId] || 0, sequence);
  }

  applyMergedTombstones(merged);
  merged.savedAt = Date.now();
  return merged;
}

export function sortOperations(operations) {
  return [...operations].sort((left, right) => {
    const comparison = compareOperations(left, right);
    if (comparison !== 0) return comparison;
    if (left.deviceId === right.deviceId) return left.sequence - right.sequence;
    return String(left.operationId).localeCompare(String(right.operationId));
  });
}
