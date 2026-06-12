import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { summarizePerf010B0Profiles } from "../performance/perf-010b0-core.js";

test("PERF-010B0 lab enables diagnostics without changing culling or WebGL isolation", async () => {
  const source = await readFile(new URL("../performance/perf-010b0-browser.js", import.meta.url), "utf8");
  assert.match(source, /perfRenderCulling:\s*"1"/);
  assert.match(source, /perfLinkDiagnostics:\s*"1"/);
  assert.match(source, /perfDisableStarWebGL:\s*"1"/);
});

test("PERF-010B0 diagnostics module loads only when the diagnostic flag is enabled", async () => {
  const source = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(source, /linkRenderDiagnosticsEnabled\s*\?\s*await import\("\.\/runtime\/link-render-diagnostics\.js"\)/);
});

test("PERF-010B0 summary separates draw stages and post-frame delay", () => {
  const summary = summarizePerf010B0Profiles([{
    marks: [
      { name: "presentation.firstReadyFrameComplete", atMs: 80 },
      { name: "presentation.uiUsable", atMs: 110 }
    ],
    spans: [
      { name: "presentation.firstReadyFrame.total", durationMs: 60 },
      { name: "presentation.firstReadyFrame.classifyVisible", durationMs: 5 },
      { name: "presentation.firstReadyFrame.drawLinks", durationMs: 20 }
    ],
    context: {
      linkRender: {
        candidateLinks: 100,
        sampledVisibleLinks: 20,
        candidateToSampledVisibleRatio: 5,
        generatePointsMs: 8,
        strokeMainMs: 4
      }
    }
  }]);

  assert.equal(summary.postFrameDelayMs.p50, 30);
  assert.equal(summary.drawLinksMs.p50, 20);
  assert.equal(summary.candidateToSampledVisibleRatio.p50, 5);
  assert.equal(summary.generatePointsMs.p50, 8);
  assert.equal(summary.strokeMainMs.p50, 4);
});
