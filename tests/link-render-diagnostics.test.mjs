import assert from "node:assert/strict";
import test from "node:test";

import {
  createExpandedViewport,
  createLinkRenderDiagnostics,
  polylineIntersectsViewport
} from "../runtime/link-render-diagnostics.js";

test("sampled link visibility detects inside, crossing, and outside polylines", () => {
  const viewport = createExpandedViewport(100, 100, 10);
  assert.equal(polylineIntersectsViewport([{ x: 50, y: 50 }], viewport), true);
  assert.equal(
    polylineIntersectsViewport([{ x: -30, y: 50 }, { x: 130, y: 50 }], viewport),
    true
  );
  assert.equal(
    polylineIntersectsViewport([{ x: -30, y: -30 }, { x: -20, y: -20 }], viewport),
    false
  );
});

test("link diagnostics reports candidate inflation, geometry, and unattributed time", () => {
  let now = 0;
  const diagnostics = createLinkRenderDiagnostics({
    width: 100,
    height: 100,
    clock: () => now
  });
  diagnostics.recordCandidates(1_000, 100);
  diagnostics.recordResolvedLink(20, false);
  diagnostics.recordSampledVisibility(true, 20);
  diagnostics.recordMainPath(20);
  const started = diagnostics.startStage();
  now += 4;
  diagnostics.endStage("generatePointsMs", started);

  const snapshot = diagnostics.snapshot(10);
  assert.equal(snapshot.candidateToSampledVisibleRatio, 100);
  assert.equal(snapshot.generatedPoints, 21);
  assert.equal(snapshot.mainPathCommands, 22);
  assert.equal(snapshot.sampledVisibleSegments, 20);
  assert.equal(snapshot.generatePointsMs, 4);
  assert.equal(snapshot.unattributedDrawLinksMs, 6);
});
