import assert from "node:assert/strict";
import test from "node:test";

import {
  collectVisibleRenderItems,
  createScreenViewport,
  getConservativeLinkScreenBounds,
  getConservativeLinkSegmentMargin,
  getConservativeNodeScreenBounds,
  isLinkPotentiallyVisible,
  isLinkSegmentPotentiallyVisible,
  isNodePotentiallyVisible
} from "../runtime/render-culling.js";
import { rebuildNodesById } from "../runtime/node-index.js";
import {
  polylineIntersectsViewport
} from "../runtime/link-render-diagnostics.js";

const camera = { x: 500, y: 300, zoom: 1 };
const viewport = createScreenViewport(1_000, 600);

function node(id, x, y, options = {}) {
  return {
    id,
    renderX: x,
    renderY: y,
    visualRadius: 14,
    vx: 0,
    vy: 0,
    ...options
  };
}

function boundsIntersect(bounds, targetViewport) {
  return (
    bounds.left <= targetViewport.right &&
    bounds.right >= targetViewport.left &&
    bounds.top <= targetViewport.bottom &&
    bounds.bottom >= targetViewport.top
  );
}

function normalize(x, y) {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length, len: length };
}

function organicPoints(aNode, bNode, testCamera, segments = 42) {
  const zoom = testCamera.zoom;
  const a = {
    x: aNode.renderX * zoom + testCamera.x,
    y: aNode.renderY * zoom + testCamera.y,
    vx: aNode.vx * zoom,
    vy: aNode.vy * zoom
  };
  const b = {
    x: bNode.renderX * zoom + testCamera.x,
    y: bNode.renderY * zoom + testCamera.y,
    vx: bNode.vx * zoom,
    vy: bNode.vy * zoom
  };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const tangent = normalize(dx, dy);
  const normal = normalize(-dy, dx);
  const points = [];
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const envelope = Math.pow(Math.sin(Math.PI * t), 1.2);
    const normalEnergy =
      (a.vx * normal.x + a.vy * normal.y) * (1 - t) +
      (b.vx * normal.x + b.vy * normal.y) * t;
    const tangEnergy =
      (a.vx * tangent.x + a.vy * tangent.y) * (1 - t) +
      (b.vx * tangent.x + b.vy * tangent.y) * t;
    const offsetNormal = normalEnergy * envelope * Math.min(18, tangent.len * 0.08);
    const offsetTang = tangEnergy * envelope * Math.min(6, tangent.len * 0.02);
    points.push({
      x: a.x + dx * t + normal.x * offsetNormal + tangent.x * offsetTang,
      y: a.y + dy * t + normal.y * offsetNormal + tangent.y * offsetTang
    });
  }
  return points;
}

test("node culling includes visible nodes and conservatively retains nearby labels", () => {
  const visible = node(1, 0, 0);
  const labelNearEdge = node(2, -600, 0);
  const far = node(3, -2_000, 0);

  assert.equal(isNodePotentiallyVisible(visible, camera, viewport), true);
  assert.equal(isNodePotentiallyVisible(labelNearEdge, camera, viewport), true);
  assert.equal(isNodePotentiallyVisible(far, camera, viewport), false);
  assert.ok(getConservativeNodeScreenBounds(visible, camera).right > 500);
});

test("center stars use a larger conservative visual bound", () => {
  const ordinary = node(1, -900, 0);
  const center = node(2, -900, 0, { isCenter: true, visualRadius: 20 });

  assert.equal(isNodePotentiallyVisible(ordinary, camera, viewport), false);
  assert.equal(isNodePotentiallyVisible(center, camera, viewport), true);
});

test("link culling retains links crossing the viewport with both endpoints outside", () => {
  const left = node(1, -1_000, 0);
  const right = node(2, 1_000, 0);
  const outsideA = node(3, -2_000, -2_000);
  const outsideB = node(4, -1_500, -1_500);

  assert.equal(isLinkPotentiallyVisible(left, right, camera, viewport), true);
  assert.equal(isLinkPotentiallyVisible(outsideA, outsideB, camera, viewport), false);
  assert.ok(getConservativeLinkScreenBounds(left, right, camera).left < 0);
});

test("allocation-free node visibility remains equivalent to conservative bounds", () => {
  const candidates = [
    node(1, 0, 0),
    node(2, -900, 0, { isCenter: true, visualRadius: 20 }),
    node(3, -600, 0),
    node(4, 2_000, 2_000)
  ];
  for (const zoom of [0.36, 1, 3]) {
    const testCamera = { x: 500, y: 300, zoom };
    for (const candidate of candidates) {
      const expected = boundsIntersect(
        getConservativeNodeScreenBounds(candidate, testCamera, 3),
        viewport
      );
      assert.equal(isNodePotentiallyVisible(candidate, testCamera, viewport, 3), expected);
    }
  }
});

test("allocation-free link visibility remains equivalent to conservative bounds", () => {
  const pairs = [
    [node(1, -1_000, 0), node(2, 1_000, 0)],
    [node(3, -2_000, -2_000), node(4, -1_500, -1_500)],
    [node(5, 0, 0, { vx: 4 }), node(6, 600, 0, { vy: -3 })]
  ];
  for (const zoom of [0.36, 1, 3]) {
    const testCamera = { x: 500, y: 300, zoom };
    for (const [aNode, bNode] of pairs) {
      const expected = boundsIntersect(
        getConservativeLinkScreenBounds(aNode, bNode, testCamera),
        viewport
      );
      assert.equal(isLinkPotentiallyVisible(aNode, bNode, testCamera, viewport), expected);
    }
  }
});

test("segment culling rejects bounding-box false positives while retaining crossings", () => {
  const originCamera = { x: 0, y: 0, zoom: 1 };
  const originViewport = createScreenViewport(1_000, 600);
  const falsePositiveA = node(1, -1_000, 500);
  const falsePositiveB = node(2, 500, -1_000);
  const crossingA = node(3, -1_000, 300);
  const crossingB = node(4, 2_000, 300);

  assert.equal(isLinkPotentiallyVisible(falsePositiveA, falsePositiveB, originCamera, originViewport), true);
  assert.equal(isLinkSegmentPotentiallyVisible(falsePositiveA, falsePositiveB, originCamera, originViewport), false);
  assert.equal(isLinkSegmentPotentiallyVisible(crossingA, crossingB, originCamera, originViewport), true);
});

test("segment margin conservatively retains sampled organic curves", () => {
  const pairs = [
    [node(1, -1_000, 0, { vx: 8, vy: -5 }), node(2, 1_000, 0, { vx: -6, vy: 9 })],
    [node(3, -900, 500, { vx: 12, vy: 12 }), node(4, 600, -900, { vx: -10, vy: 7 })],
    [node(5, 0, -1_000, { vx: 2, vy: 16 }), node(6, 0, 1_000, { vx: -3, vy: -14 })]
  ];
  for (const zoom of [0.36, 1, 3]) {
    const testCamera = { x: 500, y: 300, zoom };
    for (const [aNode, bNode] of pairs) {
      assert.ok(getConservativeLinkSegmentMargin(aNode, bNode, testCamera) >= 12);
      const curveVisible = polylineIntersectsViewport(
        organicPoints(aNode, bNode, testCamera),
        viewport
      );
      if (curveVisible) {
        assert.equal(
          isLinkSegmentPotentiallyVisible(aNode, bNode, testCamera, viewport),
          true
        );
      }
    }
  }
});

test("segment culling has no sampled false negatives across deterministic curves", () => {
  let seed = 0x10b1;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (const zoom of [0.2, 0.36, 0.75, 1, 2, 3.5]) {
    const testCamera = { x: 500, y: 300, zoom };
    for (let index = 0; index < 750; index += 1) {
      const aNode = node(index * 2, random() * 6_000 - 3_000, random() * 6_000 - 3_000, {
        vx: random() * 40 - 20,
        vy: random() * 40 - 20
      });
      const bNode = node(index * 2 + 1, random() * 6_000 - 3_000, random() * 6_000 - 3_000, {
        vx: random() * 40 - 20,
        vy: random() * 40 - 20
      });
      const curveVisible = polylineIntersectsViewport(
        organicPoints(aNode, bNode, testCamera),
        viewport
      );
      if (curveVisible) {
        assert.equal(
          isLinkSegmentPotentiallyVisible(aNode, bNode, testCamera, viewport),
          true,
          `false negative at zoom ${zoom}, sample ${index}`
        );
      }
    }
  }
});

test("collection reuses outputs and reports total, considered, and drawn counts", () => {
  const nodes = [
    node(1, 0, 0),
    node(2, 100, 0),
    node(3, 2_000, 2_000)
  ];
  const links = [
    { from: 1, to: 2 },
    { from: 2, to: 3 }
  ];
  const visibleNodes = [];
  const visibleLinks = [];
  const result = collectVisibleRenderItems({
    nodes,
    links,
    nodesById: rebuildNodesById(nodes),
    camera,
    width: 1_000,
    height: 600,
    visibleNodes,
    visibleLinks
  });

  assert.equal(result.visibleNodes, visibleNodes);
  assert.equal(result.visibleLinks, visibleLinks);
  assert.deepEqual(result.metrics, {
    totalNodes: 3,
    totalLinks: 2,
    consideredNodes: 3,
    consideredLinks: 2,
    drawnNodes: 2,
    drawnLinks: 2,
    boundingBoxLinks: 2,
    segmentRejectedLinks: 0,
    linkCullingMode: "bounding-box"
  });
});

test("collection applies segment rejection only when explicitly enabled", () => {
  const testCamera = { x: 0, y: 0, zoom: 1 };
  const nodes = [
    node(1, -1_000, 500),
    node(2, 500, -1_000)
  ];
  const links = [{ from: 1, to: 2 }];
  const baseline = collectVisibleRenderItems({
    nodes,
    links,
    nodesById: rebuildNodesById(nodes),
    camera: testCamera,
    width: 1_000,
    height: 600
  });
  const segment = collectVisibleRenderItems({
    nodes,
    links,
    nodesById: rebuildNodesById(nodes),
    camera: testCamera,
    width: 1_000,
    height: 600,
    linkSegmentCulling: true
  });

  assert.equal(baseline.metrics.drawnLinks, 1);
  assert.equal(segment.metrics.drawnLinks, 0);
  assert.equal(segment.metrics.boundingBoxLinks, 1);
  assert.equal(segment.metrics.segmentRejectedLinks, 1);
});
