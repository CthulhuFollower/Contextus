import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PERF_010B2A_MODES,
  summarizePerf010B2AProfiles
} from "../performance/perf-010b2a-core.js";

test("PERF-010B2A keeps B1 active and exposes only diagnostic variants", async () => {
  const labSource = await readFile(new URL("../performance/perf-010b2a-browser.js", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(labSource, /perfLinkSegmentCulling:\s*"1"/);
  assert.match(labSource, /perfLinkCostDiagnostics:\s*"1"/);
  assert.match(labSource, /perfLinkCostMode:\s*mode/);
  assert.match(labSource, /rotatedModes\(modes, index\)/);
  assert.doesNotMatch(labSource, /perfLinkDiagnostics/);
  assert.match(
    appSource,
    /linkCostDiagnosticsEnabled\s*\?\s*await import\("\.\/runtime\/link-cost-diagnostics\.js"\)/
  );
  assert.deepEqual(PERF_010B2A_MODES, [
    "current",
    "points-only",
    "path-no-stroke",
    "straight",
    "reduced-segments",
    "uniform-batch",
    "no-active"
  ]);
});

test("PERF-010B2A summary preserves global and bucket attribution", () => {
  const summary = summarizePerf010B2AProfiles([{
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
      linkCost: {
        resolvedLinks: 20,
        generatedSegments: 160,
        strokeCalls: 20,
        generatePointsMs: 6,
        buckets: {
          length: { "100-500": { links: 20, averageGeneratedSegments: 8 } },
          segments: {},
          curvature: {}
        }
      }
    }
  }]);

  assert.equal(summary.postFrameDelayMs.p50, 20);
  assert.equal(summary.drawnLinks.p50, 20);
  assert.equal(summary.generatedSegments.p50, 160);
  assert.equal(summary.buckets.length["100-500"].averageGeneratedSegments.p50, 8);
});
