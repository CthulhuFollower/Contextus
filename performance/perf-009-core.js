import { LocalSyncEngine, MemorySyncStore } from "../sync/local-sync-engine.js";
import { migrateLegacyWorkspace } from "../sync/workspace-model.js";
import { createMentalMapDataset } from "./dataset-generator.js";
import { summarizeSamples } from "./perf-004-core.js";

export const PERF_009_TOPOLOGIES = ["single-map", "many-maps"];
export const PERF_009_SCENARIOS = ["clean", "pending-shared", "structural-private"];

function mapCountFor(totalNodes, topology) {
  if (topology === "single-map") return 1;
  if (topology !== "many-maps") throw new RangeError(`Unknown PERF-009 topology: ${topology}`);
  return Math.min(50, Math.max(10, Math.floor(totalNodes / 1_000)));
}

export function createPerf009Workspace({
  totalNodes,
  topology,
  noteSize = 100
}) {
  const mapCount = mapCountFor(totalNodes, topology);
  const baseCount = Math.floor(totalNodes / mapCount);
  let remainder = totalNodes % mapCount;
  const maps = [];

  for (let index = 0; index < mapCount; index += 1) {
    const nodeCount = baseCount + (remainder > 0 ? 1 : 0);
    remainder -= remainder > 0 ? 1 : 0;
    const { map } = createMentalMapDataset({
      nodeCount,
      noteSize,
      mapId: index + 1,
      seed: 0x43_6f_6e_74 + index
    });
    maps.push(map);
  }

  return {
    version: 7,
    activeMapId: maps[0].id,
    mapIdCounter: maps.length,
    mapsView: { x: 0, y: 0, targetX: 0, targetY: 0, zoom: 1, targetZoom: 1 },
    maps
  };
}

export function createPerf009Fixture({
  totalNodes,
  topology,
  scenario,
  noteSize = 100,
  pendingOperationCount = 200
}) {
  if (!PERF_009_SCENARIOS.includes(scenario)) {
    throw new RangeError(`Unknown PERF-009 scenario: ${scenario}`);
  }
  const workspace = createPerf009Workspace({ totalNodes, topology, noteSize });
  const workspaceId = `workspace_perf009_${totalNodes}_${topology}_${scenario}`;
  const deviceId = `device_perf009_${totalNodes}_${topology}_${scenario}`;
  const migrated = migrateLegacyWorkspace(workspace, { workspaceId, deviceId });
  return {
    totalNodes,
    topology,
    scenario,
    noteSize,
    pendingOperationCount: scenario === "pending-shared" ? pendingOperationCount : 0,
    structuralPrivate: scenario === "structural-private",
    workspace,
    sharedSnapshot: migrated.sharedSnapshot,
    deviceSnapshot: migrated.deviceSnapshot
  };
}

function structuralPrivatePatches(fixture) {
  const patches = [
    { type: "setActiveMap", activeMapSyncId: fixture.sharedSnapshot.maps.at(-1).syncId },
    {
      type: "setConstellationView",
      view: { x: 70, y: -50, targetX: 72, targetY: -48, zoom: 2, targetZoom: 2.1 }
    }
  ];
  for (const [index, map] of fixture.sharedSnapshot.maps.entries()) {
    patches.push({
      type: "setMapCamera",
      mapSyncId: map.syncId,
      camera: {
        x: index * 10,
        y: index * -10,
        targetX: index * 10 + 2,
        targetY: index * -10 + 2,
        zoom: 1 + index / 100,
        targetZoom: 1 + index / 100
      }
    });
    patches.push({
      type: "setSelectedNode",
      mapSyncId: map.syncId,
      selectedNodeSyncId: map.nodes.at(-1)?.syncId || null
    });
  }
  return patches;
}

export async function seedPerf009Store(store, fixture) {
  if (typeof store.clear === "function") await store.clear();
  await store.writeMigration({
    sharedSnapshot: fixture.sharedSnapshot,
    deviceSnapshot: fixture.deviceSnapshot
  });

  const engine = new LocalSyncEngine({ store });
  await engine.initialize();
  for (let index = 0; index < fixture.pendingOperationCount; index += 1) {
    const map = engine.sharedSnapshot.maps[index % engine.sharedSnapshot.maps.length];
    const node = map.nodes[(index * 97 + 1) % map.nodes.length];
    await engine.recordSharedChange(
      "node.move",
      { kind: "node", mapSyncId: map.syncId, syncId: node.syncId },
      {
        mapSyncId: map.syncId,
        nodeSyncId: node.syncId,
        position: { x: node.x + index + 1, y: node.y - index - 1 }
      }
    );
  }
  if (fixture.structuralPrivate) {
    await engine.recordDevicePatches(structuralPrivatePatches(fixture));
  }
  return engine;
}

export async function createPerf009MemoryStore(fixture) {
  const store = new MemorySyncStore();
  const engine = await seedPerf009Store(store, fixture);
  return { store, engine };
}

function stageTotals(profile) {
  const totals = new Map();
  for (const span of profile.spans || []) {
    totals.set(span.name, (totals.get(span.name) || 0) + span.durationMs);
  }
  return totals;
}

export function summarizeStartupProfiles(profiles) {
  const stageNames = new Set();
  const totals = profiles.map(profile => {
    const values = stageTotals(profile);
    for (const name of values.keys()) stageNames.add(name);
    return values;
  });
  const stages = {};
  for (const name of [...stageNames].sort()) {
    stages[name] = summarizeSamples(totals.map(values => values.get(name) || 0));
  }
  return {
    totalMs: summarizeSamples(profiles.map(profile => profile.totalMs)),
    stages
  };
}
