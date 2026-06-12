function defaultClock() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function readMemory() {
  const value = globalThis.performance?.memory?.usedJSHeapSize;
  return Number.isFinite(value) ? value : null;
}

function cloneMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return {};
  return { ...metadata };
}

export class StartupProfiler {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.clock = options.clock || defaultClock;
    this.startedAt = Number.isFinite(options.startedAt) ? options.startedAt : this.clock();
    this.runId = options.runId || null;
    this.context = cloneMetadata(options.context);
    this.spans = [];
    this.marks = [];
    this.completedAt = null;
  }

  start(name, metadata = {}) {
    if (!this.enabled) return () => 0;
    const startedAt = this.clock();
    const memoryBefore = readMemory();
    let ended = false;

    return (endMetadata = {}) => {
      if (ended) return 0;
      ended = true;
      const endedAt = this.clock();
      const durationMs = endedAt - startedAt;
      const memoryAfter = readMemory();
      this.spans.push({
        name,
        startedAtMs: startedAt - this.startedAt,
        durationMs,
        memoryBefore,
        memoryAfter,
        memoryDelta: memoryBefore === null || memoryAfter === null ? null : memoryAfter - memoryBefore,
        ...cloneMetadata(metadata),
        ...cloneMetadata(endMetadata)
      });
      return durationMs;
    };
  }

  mark(name, metadata = {}) {
    if (!this.enabled) return null;
    const mark = {
      name,
      atMs: this.clock() - this.startedAt,
      memory: readMemory(),
      ...cloneMetadata(metadata)
    };
    this.marks.push(mark);
    return mark;
  }

  setContext(metadata = {}) {
    Object.assign(this.context, cloneMetadata(metadata));
  }

  complete(metadata = {}) {
    if (this.completedAt === null) this.completedAt = this.clock();
    this.setContext(metadata);
    return this.snapshot();
  }

  snapshot() {
    const endedAt = this.completedAt ?? this.clock();
    return {
      schemaVersion: 1,
      runId: this.runId,
      totalMs: endedAt - this.startedAt,
      context: { ...this.context },
      marks: this.marks.map(mark => ({ ...mark })),
      spans: this.spans.map(span => ({ ...span }))
    };
  }
}

export class NoopStartupProfiler {
  constructor() {
    this.enabled = false;
  }

  start() {
    return () => 0;
  }

  mark() {
    return null;
  }

  setContext() {}

  complete() {
    return this.snapshot();
  }

  snapshot() {
    return {
      schemaVersion: 1,
      runId: null,
      totalMs: 0,
      context: {},
      marks: [],
      spans: []
    };
  }
}

export function createStartupProfiler(options = {}) {
  return options.enabled === false
    ? new NoopStartupProfiler()
    : new StartupProfiler(options);
}

export function measureStartupSync(profiler, name, task, metadata = {}) {
  if (!profiler?.enabled) return task();
  const end = profiler?.start?.(name, metadata);
  try {
    return task();
  } finally {
    end?.();
  }
}

export function measureStartupAsync(profiler, name, task, metadata = {}) {
  if (!profiler?.enabled) return task();
  const end = profiler?.start?.(name, metadata);
  return (async () => {
    try {
      return await task();
    } finally {
      end?.();
    }
  })();
}
