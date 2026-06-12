import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { summarizePerf010B1Profiles } from "../performance/perf-010b1-core.js";

test("PERF-010B1 compares A1 and segment rejection on the same culling route", async () => {
  const source = await readFile(new URL("../performance/perf-010b1-browser.js", import.meta.url), "utf8");
  const applicationSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(source, /perfRenderCulling:\s*"1"/);
  assert.match(source, /perfLinkSegmentCulling:\s*mode === "b1" \? "1" : "0"/);
  assert.match(source, /perfDisableStarWebGL:\s*"1"/);
  assert.doesNotMatch(source, /perfLinkDiagnostics/);
  assert.match(
    applicationSource,
    /renderCullingEnabled && startupSearchParams\.get\("perfLinkSegmentCulling"\) !== "0"/
  );
});

test("PERF-010B1 summary reports rejection and productive draw timings", () => {
  const summary = summarizePerf010B1Profiles([{
    marks: [{ name: "presentation.uiUsable", atMs: 120 }],
    spans: [
      { name: "presentation.firstReadyFrame.total", durationMs: 70 },
      { name: "presentation.firstReadyFrame.classifyVisible", durationMs: 8 },
      { name: "presentation.firstReadyFrame.drawLinks", durationMs: 30 },
      { name: "presentation.firstReadyFrame.drawNodes", durationMs: 4 }
    ],
    context: {
      renderCulling: {
        boundingBoxLinks: 100,
        segmentRejectedLinks: 60,
        drawnLinks: 40
      }
    }
  }]);

  assert.equal(summary.drawLinksMs.p50, 30);
  assert.equal(summary.boundingBoxLinks.p50, 100);
  assert.equal(summary.segmentRejectedLinks.p50, 60);
  assert.equal(summary.drawnLinks.p50, 40);
});
