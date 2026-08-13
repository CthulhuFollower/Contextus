import assert from "node:assert/strict";
import test from "node:test";

import {
  LINK_ADAPTIVE_DIAGNOSTIC_MODES,
  createLinkAdaptiveDiagnostics
} from "../runtime/link-adaptive-diagnostics.js";

test("link adaptive diagnostics exposes only the accepted B2B mode", () => {
  assert.deepEqual(LINK_ADAPTIVE_DIAGNOSTIC_MODES, ["spatial-quad"]);
  assert.throws(
    () => createLinkAdaptiveDiagnostics({ mode: "production-change" }),
    /Unknown link adaptive diagnostic mode/
  );
});

test("link adaptive diagnostics records spatial quadratic savings", () => {
  const diagnostics = createLinkAdaptiveDiagnostics({ mode: "spatial-quad", clock: () => 0 });
  const descriptor = diagnostics.recordResolvedLink({ originalSegments: 42, active: true });
  diagnostics.recordSpatialQuadraticGeometry(descriptor, {
    bendPx: 12,
    visualDeviationPx: 6
  });
  diagnostics.recordPath(3);
  diagnostics.recordStyle("active-main");
  diagnostics.recordStroke();

  const snapshot = diagnostics.snapshot(1);
  assert.equal(snapshot.activeLinks, 1);
  assert.equal(snapshot.spatialQuadraticLinks, 1);
  assert.equal(snapshot.generatedSegments, 1);
  assert.equal(snapshot.generatedPoints, 3);
  assert.equal(snapshot.savedSegments, 41);
  assert.equal(snapshot.savedPathCommands, 41);
  assert.equal(snapshot.bendPx.max, 12);
  assert.equal(snapshot.visualDeviationPx.max, 6);
});
