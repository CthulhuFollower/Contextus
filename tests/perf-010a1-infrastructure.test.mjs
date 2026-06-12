import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PERF_010A1_CAMERAS,
  classifyPerf010A1Fixture,
  createPerf010A1Fixture
} from "../performance/perf-010a1-core.js";

test("PERF-010A1 cameras preserve the same universe and private camera state", () => {
  for (const cameraName of PERF_010A1_CAMERAS) {
    const fixture = createPerf010A1Fixture({ nodeCount: 1_000, cameraName });
    assert.equal(fixture.map.nodes.length, 1_000);
    assert.equal(
      fixture.deviceSnapshot.mapStates[fixture.map.syncId].camera.zoom,
      fixture.map.camera.zoom
    );
  }
});

test("PERF-010A1 culling is conservative and responds to camera visibility", () => {
  const normal = classifyPerf010A1Fixture(
    createPerf010A1Fixture({ nodeCount: 10_000, cameraName: "normal" })
  );
  const zoomedOut = classifyPerf010A1Fixture(
    createPerf010A1Fixture({ nodeCount: 10_000, cameraName: "zoom-out" })
  );
  const empty = classifyPerf010A1Fixture(
    createPerf010A1Fixture({ nodeCount: 10_000, cameraName: "empty" })
  );

  assert.ok(normal.metrics.drawnNodes > 0);
  assert.ok(normal.metrics.drawnNodes < normal.metrics.totalNodes);
  assert.equal(zoomedOut.metrics.drawnNodes, zoomedOut.metrics.totalNodes);
  assert.equal(empty.metrics.drawnNodes, 0);
  assert.equal(empty.metrics.drawnLinks, 0);
});

test("PERF-010A1 isolates the mind-map benchmark from the center-star WebGL renderer", async () => {
  const source = await readFile(new URL("../performance/perf-010a1-browser.js", import.meta.url), "utf8");
  assert.match(source, /perfDisableStarWebGL:\s*"1"/);
});
