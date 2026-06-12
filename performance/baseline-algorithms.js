// These functions intentionally preserve the current array-based behavior from index.html.
// They are isolated so the baseline remains measurable while production code is unchanged.

export function baselineGetNodeById(nodes, id) {
  return nodes.find(node => node.id === id);
}

export function baselineGetChildren(nodes, parentId) {
  return nodes.filter(node => node.parentId === parentId);
}

export function baselineGetDescendants(nodes, nodeId) {
  const result = [];
  const stack = [nodeId];

  while (stack.length) {
    const current = stack.pop();
    const children = nodes.filter(node => node.parentId === current);
    for (const child of children) {
      result.push(child.id);
      stack.push(child.id);
    }
  }

  return result;
}

export function baselineGetMapById(maps, mapId) {
  const index = maps.findIndex(map => map.id === mapId);
  return index >= 0 ? maps[index] : null;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function normalize(x, y) {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len, len };
}

function projectWorldPoint(x, y, camera) {
  return {
    x: x * camera.zoom + camera.x,
    y: y * camera.zoom + camera.y
  };
}

function organicPointOnLink(a, b, t) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const tangent = normalize(dx, dy);
  const normal = normalize(-dy, dx);
  const dist = tangent.len;
  const baseX = lerp(a.x, b.x, t);
  const baseY = lerp(a.y, b.y, t);
  const envelope = Math.pow(Math.sin(Math.PI * t), 1.2);
  const normalVelA = a.vx * normal.x + a.vy * normal.y;
  const normalVelB = b.vx * normal.x + b.vy * normal.y;
  const tangVelA = a.vx * tangent.x + a.vy * tangent.y;
  const tangVelB = b.vx * tangent.x + b.vy * tangent.y;
  const normalEnergy = lerp(normalVelA, normalVelB, t);
  const tangEnergy = lerp(tangVelA, tangVelB, t);
  const offsetNormal = normalEnergy * envelope * Math.min(18, dist * 0.08);
  const offsetTang = tangEnergy * envelope * Math.min(6, dist * 0.02);

  return {
    x: baseX + normal.x * offsetNormal + tangent.x * offsetTang,
    y: baseY + normal.y * offsetNormal + tangent.y * offsetTang
  };
}

export function createCanvasContextStub() {
  let calls = 0;
  return {
    beginPath() { calls += 1; },
    moveTo() { calls += 1; },
    quadraticCurveTo() { calls += 1; },
    lineTo() { calls += 1; },
    stroke() { calls += 1; },
    set strokeStyle(value) { calls += value.length > 0 ? 1 : 0; },
    set lineWidth(value) { calls += value > 0 ? 1 : 0; },
    getCalls() { return calls; }
  };
}

export function baselineDrawLinks({
  nodes,
  links,
  ctx = createCanvasContextStub(),
  camera = { x: 0, y: 0, zoom: 1 },
  selectedNodeId = 1,
  getNodeById = id => baselineGetNodeById(nodes, id)
}) {
  const zoom = camera.zoom;
  let checksum = 0;

  for (const link of links) {
    const aNode = getNodeById(link.from);
    const bNode = getNodeById(link.to);
    if (!aNode || !bNode) continue;

    const aPoint = projectWorldPoint(aNode.renderX, aNode.renderY, camera);
    const bPoint = projectWorldPoint(bNode.renderX, bNode.renderY, camera);
    const a = { x: aPoint.x, y: aPoint.y, vx: aNode.vx * zoom, vy: aNode.vy * zoom };
    const b = { x: bPoint.x, y: bPoint.y, vx: bNode.vx * zoom, vy: bNode.vy * zoom };
    const active = aNode.id === selectedNodeId || bNode.id === selectedNodeId;
    const totalEnergy = Math.abs(a.vx) + Math.abs(a.vy) + Math.abs(b.vx) + Math.abs(b.vy);
    link.lastEnergy = link.lastEnergy * 0.85 + totalEnergy * 0.15;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const segments = Math.max(18, Math.min(42, Math.floor(dist / 10)));
    const points = [];

    for (let index = 0; index <= segments; index += 1) {
      points.push(organicPointOnLink(a, b, index / segments));
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length - 1; index += 1) {
      const mx = (points[index].x + points[index + 1].x) * 0.5;
      const my = (points[index].y + points[index + 1].y) * 0.5;
      ctx.quadraticCurveTo(points[index].x, points[index].y, mx, my);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.strokeStyle = active ? "rgba(218, 235, 248, 0.42)" : "rgba(150, 182, 205, 0.16)";
    ctx.lineWidth = Math.max(0.45, (active ? 1.55 : 1.1) * zoom);
    ctx.stroke();
    checksum += points.length + link.lastEnergy;
  }

  return checksum + ctx.getCalls();
}

export function baselineDeleteTree(nodes, links, rootNodeId) {
  const node = baselineGetNodeById(nodes, rootNodeId);
  if (!node || node.isCenter) return 0;

  const descendants = baselineGetDescendants(nodes, node.id);
  const idsToDelete = new Set([node.id, ...descendants]);
  const deletedNodes = nodes.filter(existingNode => idsToDelete.has(existingNode.id));
  const deletedLinks = links.filter(link => idsToDelete.has(link.from) || idsToDelete.has(link.to));

  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (idsToDelete.has(nodes[index].id)) nodes.splice(index, 1);
  }
  for (let index = links.length - 1; index >= 0; index -= 1) {
    if (idsToDelete.has(links[index].from) || idsToDelete.has(links[index].to)) {
      links.splice(index, 1);
    }
  }

  baselineGetNodeById(nodes, node.parentId);
  return deletedNodes.length + deletedLinks.length;
}

export function estimateDrawLinkFindComparisons(links) {
  let comparisons = 0;
  for (const link of links) comparisons += link.from + link.to;
  return comparisons;
}
