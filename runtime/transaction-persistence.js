export const TRANSACTION_PERSISTENCE_CONTRACT = Object.freeze({
  deleteMapAndSelectFallback: Object.freeze({ shared: true, private: true, fastShared: false }),
  updateViewFrame: Object.freeze({ shared: false, private: true, fastShared: false, fastPrivate: true }),
  switchMap: Object.freeze({ shared: false, private: true, fastShared: false, fastPrivate: true }),
  createMap: Object.freeze({ shared: true, private: true, fastShared: false }),
  createNode: Object.freeze({ shared: true, private: true, fastShared: false }),
  deleteNodeTree: Object.freeze({ shared: true, private: true, fastShared: false }),
  editNode: Object.freeze({ shared: true, private: false, fastShared: true }),
  moveNode: Object.freeze({ shared: true, private: false, fastShared: true }),
  moveConstellationMap: Object.freeze({ shared: true, private: false, fastShared: true })
});

export function getTransactionPersistenceContract(type) {
  const contract = TRANSACTION_PERSISTENCE_CONTRACT[type];
  if (!contract) {
    throw new RangeError(`Unknown transaction persistence contract: ${type}`);
  }
  return contract;
}

function finitePosition(position) {
  if (!position) return null;
  const x = Number(position.x);
  const y = Number(position.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function createFastSharedChange(type, payload = {}, identity = {}) {
  const contract = getTransactionPersistenceContract(type);
  if (!contract.fastShared) return null;

  const mapSyncId = payload.mapSyncId || identity.mapSyncId || null;
  if (!mapSyncId) return null;

  if (type === "moveConstellationMap") {
    const position = finitePosition(payload.to);
    return position
      ? {
          type: "map.move",
          target: { kind: "map", syncId: mapSyncId },
          payload: { mapSyncId, position }
        }
      : null;
  }

  const nodeSyncId = payload.nodeSyncId || payload.syncId || identity.nodeSyncId || null;
  if (!nodeSyncId) return null;

  if (type === "moveNode") {
    const position = finitePosition(payload.to);
    return position
      ? {
          type: "node.move",
          target: { kind: "node", mapSyncId, syncId: nodeSyncId },
          payload: { mapSyncId, nodeSyncId, position }
        }
      : null;
  }

  const changes = {};
  if (payload.label !== payload.previousLabel) changes.label = payload.label;
  if (payload.note !== payload.previousNote) changes.note = payload.note;
  return Object.keys(changes).length
    ? {
        type: "node.edit",
        target: { kind: "node", mapSyncId, syncId: nodeSyncId },
        payload: { mapSyncId, nodeSyncId, changes }
      }
    : null;
}

export function requiresWorkspaceCapture(
  type,
  fastSharedChange = null,
  fastDevicePatches = null
) {
  const contract = getTransactionPersistenceContract(type);
  const sharedReady = !contract.shared || Boolean(fastSharedChange);
  const privateReady = !contract.private || Array.isArray(fastDevicePatches);
  return !(sharedReady && privateReady);
}
