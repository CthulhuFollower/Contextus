import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PERF_010B2B_MODES,
  summarizePerf010B2BProfiles
} from "../performance/perf-010b2b-core.js";

test("PERF-010B2B keeps B1 active and uses only adaptive diagnostics", async () => {
  const labSource = await readFile(new URL("../performance/perf-010b2b-browser.js", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const serviceWorkerSource = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");

  assert.match(labSource, /perfLinkSegmentCulling:\s*"1"/);
  assert.match(labSource, /perfLinkAdaptiveDiagnostics:\s*"1"/);
  assert.match(labSource, /perfLinkAdaptiveMode:\s*mode/);
  assert.match(labSource, /perfLinkAdaptiveVelocityFixture/);
  assert.doesNotMatch(labSource, /perfLinkCostDiagnostics/);
  assert.match(
    appSource,
    /linkAdaptiveDiagnosticsEnabled\s*\?\s*await import\("\.\/runtime\/link-adaptive-diagnostics\.js"\)/
  );
  assert.match(appSource, /from "\.\/runtime\/link-adaptive-geometry\.js"/);
  assert.match(serviceWorkerSource, /"\.\/runtime\/link-adaptive-geometry\.js"/);
  assert.deepEqual(PERF_010B2B_MODES, ["spatial-quad"]);
});

test("PERF-010B2B summary reports spatial geometry and savings metrics", () => {
  const summary = summarizePerf010B2BProfiles([{
    marks: [
      { name: "presentation.firstReadyFrameComplete", atMs: 80 },
      { name: "presentation.uiUsable", atMs: 100 }
    ],
    spans: [
      { name: "presentation.firstReadyFrame.total", durationMs: 60 },
      { name: "presentation.firstReadyFrame.classifyVisible", durationMs: 8 },
      { name: "presentation.firstReadyFrame.drawLinks", durationMs: 30 }
    ],
    context: {
      renderCulling: { drawnLinks: 20, segmentRejectedLinks: 10 },
      linkAdaptive: {
        resolvedLinks: 20,
        spatialQuadraticLinks: 20,
        savedSegments: 600,
        savedPathCommands: 620,
        visualDeviationPx: { p95: 8, max: 12 }
      }
    }
  }]);

  assert.equal(summary.postFrameDelayMs.p50, 20);
  assert.equal(summary.drawnLinks.p50, 20);
  assert.equal(summary.spatialQuadraticLinks.p50, 20);
  assert.equal(summary.savedSegments.p50, 600);
  assert.equal(summary.savedPathCommands.p50, 620);
  assert.equal(summary.visualDeviationPxP95.p50, 8);
  assert.equal(summary.visualDeviationPxMax.p50, 12);
});
