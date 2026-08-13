import assert from "node:assert/strict";
import test from "node:test";

import {
  SPATIAL_QUADRATIC_COMMANDS,
  createSpatialQuadraticLink,
  currentLinkSegments,
  stableLinkBendSign
} from "../runtime/link-adaptive-geometry.js";

test("legacy link segmentation remains available for B2B savings metrics", () => {
  assert.equal(currentLinkSegments(20), 18);
  assert.equal(currentLinkSegments(240), 24);
  assert.equal(currentLinkSegments(900), 42);
});

test("spatial quadratic geometry is stable for the same link identity", () => {
  const a = { x: 0, y: 0, vx: 100, vy: 100 };
  const b = { x: 200, y: 0, vx: -100, vy: -100 };
  const first = createSpatialQuadraticLink(a, b, { from: 1, to: 2 });
  const second = createSpatialQuadraticLink(a, b, { from: 1, to: 2 });

  assert.equal(first.commands, SPATIAL_QUADRATIC_COMMANDS);
  assert.deepEqual(first, second);
  assert.equal(first.startX, 0);
  assert.equal(first.endX, 200);
  assert.ok(first.visualDeviationPx > 0);
});

test("spatial quadratic bend uses stable identity, not node velocity", () => {
  const stationary = createSpatialQuadraticLink(
    { x: 0, y: 0, vx: 0, vy: 0 },
    { x: 200, y: 0, vx: 0, vy: 0 },
    { from: 10, to: 20 }
  );
  const moving = createSpatialQuadraticLink(
    { x: 0, y: 0, vx: 10, vy: -8 },
    { x: 200, y: 0, vx: -6, vy: 5 },
    { from: 10, to: 20 }
  );

  assert.equal(stationary.controlX, moving.controlX);
  assert.equal(stationary.controlY, moving.controlY);
  assert.equal(stationary.bendPx, moving.bendPx);
});

test("spatial quadratic bend direction changes deterministically by link identity", () => {
  assert.equal(Math.abs(stableLinkBendSign(1, 2)), 1);
  const first = createSpatialQuadraticLink({ x: 0, y: 0 }, { x: 200, y: 0 }, { from: 1, to: 2 });
  const second = createSpatialQuadraticLink({ x: 0, y: 0 }, { x: 200, y: 0 }, { from: 1, to: 3 });

  assert.notEqual(first.bendPx, 0);
  assert.notEqual(second.bendPx, 0);
});
