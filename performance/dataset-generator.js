const DEFAULT_SEED = 0x43_6f_6e_74;

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function createNote(size, id) {
  if (size <= 0) return "";
  const prefix = `Nota ${id}: `;
  return (prefix + "contextus ".repeat(Math.ceil(size / 10))).slice(0, size);
}

function parentForNode(id, shape, branchingFactor, random) {
  if (id === 1) return null;
  if (shape === "star") return 1;
  if (shape === "deep") return id - 1;
  if (shape === "mixed") {
    if (id <= branchingFactor + 1 || random() < 0.1) return 1;
    return 1 + Math.floor(random() * (id - 1));
  }
  return Math.floor((id - 2) / branchingFactor) + 1;
}

export function createMentalMapDataset({
  nodeCount,
  shape = "balanced",
  branchingFactor = 4,
  noteSize = 100,
  seed = DEFAULT_SEED,
  mapId = 1
}) {
  if (!Number.isInteger(nodeCount) || nodeCount < 1) {
    throw new RangeError("nodeCount must be a positive integer");
  }
  if (!["balanced", "star", "deep", "mixed"].includes(shape)) {
    throw new RangeError(`Unknown dataset shape: ${shape}`);
  }

  const random = createRandom(seed);
  const nodes = [];
  const links = [];
  const levels = new Uint32Array(nodeCount + 1);

  for (let id = 1; id <= nodeCount; id += 1) {
    const parentId = parentForNode(id, shape, branchingFactor, random);
    const level = parentId === null ? 0 : levels[parentId] + 1;
    levels[id] = level;
    const angle = id * 2.399963229728653;
    const radius = 80 + level * 115;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;

    nodes.push({
      id,
      syncId: `node_${mapId}_${id}`,
      parentId,
      parentSyncId: parentId === null ? null : `node_${mapId}_${parentId}`,
      level,
      isCenter: id === 1,
      label: id === 1 ? "Centro" : `Nodo ${id}`,
      note: createNote(noteSize, id),
      x,
      y,
      vx: ((id % 5) - 2) * 0.002,
      vy: ((id % 7) - 3) * 0.002,
      renderX: x,
      renderY: y,
      baseRadius: id === 1 ? 20 : 14,
      visualRadius: id === 1 ? 20 : 14,
      targetRadius: id === 1 ? 20 : 14,
      pulseUntil: 0,
      labelFloatSeed: random() * Math.PI * 2
    });

    if (parentId !== null) {
      links.push({ from: parentId, to: id, lastEnergy: 0 });
    }
  }

  const map = {
    id: mapId,
    syncId: `map_${mapId}`,
    starType: "yellow",
    starVariant: "default",
    starScale: 1,
    starLuminosity: 1,
    nodeIdCounter: nodeCount,
    selectedNodeId: 1,
    constellationPosition: { x: mapId * 10, y: mapId * -10 },
    camera: { x: 0, y: 0, targetX: 0, targetY: 0, zoom: 1, targetZoom: 1 },
    nodes,
    links
  };

  return { map, nodes, links };
}

export function createMapList(mapCount) {
  if (!Number.isInteger(mapCount) || mapCount < 1) {
    throw new RangeError("mapCount must be a positive integer");
  }

  return Array.from({ length: mapCount }, (_, index) => {
    const id = index + 1;
    return {
      id,
      syncId: `map_${id}`,
      nodes: [],
      links: []
    };
  });
}

export function countSubtreeNodes(nodes, rootId) {
  const childrenByParent = new Map();
  for (const node of nodes) {
    const children = childrenByParent.get(node.parentId) || [];
    children.push(node.id);
    childrenByParent.set(node.parentId, children);
  }

  let count = 0;
  const stack = [rootId];
  while (stack.length) {
    const current = stack.pop();
    count += 1;
    stack.push(...(childrenByParent.get(current) || []));
  }
  return count;
}
