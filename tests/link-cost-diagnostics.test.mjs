import assert from "node:assert/strict";
import test from "node:test";

import {
  LINK_COST_DIAGNOSTIC_MODES,
  createLinkCostDiagnostics
} from "../runtime/link-cost-diagnostics.js";

test("link cost diagnostics rejects unknown non-productive modes", () => {
  assert.ok(LINK_COST_DIAGNOSTIC_MODES.includes("current"));
  assert.ok(LINK_COST_DIAGNOSTIC_MODES.includes("uniform-batch"));
  assert.throws(
    () => createLinkCostDiagnostics({ mode: "production-change" }),
    /Unknown link cost diagnostic mode/
  );
});

test("link cost diagnostics aggregates geometry and time into structural buckets", () => {
  let now = 0;
  const diagnostics = createLinkCostDiagnostics({
    mode: "current",
    clock: () => now
  });
  const descriptor = diagnostics.recordResolvedLink({
    lengthPx: 240,
    originalSegments: 24,
    curvaturePx: 7,
    active: true
  });
  diagnostics.recordGeneratedGeometry(descriptor, 8);
  diagnostics.recordPath(descriptor, 10);
  diagnostics.recordStyle("active-main");
  diagnostics.recordStroke(descriptor);
  const started = diagnostics.startStage();
  now += 4;
  diagnostics.endStage("generatePointsMs", started, descriptor);

  const snapshot = diagnostics.snapshot(9);
  assert.equal(snapshot.resolvedLinks, 1);
  assert.equal(snapshot.originalSegments, 24);
  assert.equal(snapshot.generatedSegments, 8);
  assert.equal(snapshot.distinctStyles, 1);
  assert.equal(snapshot.buckets.length["100-500"].links, 1);
  assert.equal(snapshot.buckets.segments["19-29"].averageGeneratedSegments, 8);
  assert.equal(snapshot.buckets.curvature["2-12"].generatePointsMsPerLink, 4);
  assert.equal(snapshot.unattributedDrawLinksMs, 5);
});
