import * as THREE from "../vendor/three/three.module.js";

export const BLACK_HOLE_STATES = Object.freeze({
  IDLE: "idle",
  PREPARING: "preparing",
  FORMING: "forming",
  FORMED: "formed",
  CONTAINING: "containing",
  POSTPONED: "postponed",
  REPAIRING: "repairing",
  FAILED: "failed"
});

export const BLACK_HOLE_RENDER_STAGES = Object.freeze({
  LENSING: "lensing",
  REAR: "rear",
  SHADOW: "shadow",
  FRONT: "front"
});

const LUT_SAMPLE_COUNT = 2048;
const LUT_CHANNEL_COUNT = 4;
const FORMATION_DURATION = 5000;
const CONTAINMENT_DURATION = 700;
const REPAIR_DURATION = 900;
const QUALITY_SCALES = Object.freeze({
  low: 0.6,
  medium: 0.85,
  high: 1.25
});
const QUALITY_ORDER = ["low", "medium", "high"];
const lutRequests = new Map();
const DEFAULT_LENSING_PROFILE = Object.freeze({
  distortion: 0.95,
  arcStrength: 0.91,
  chromaticShift: 0,
  breathing: 0.12,
  influenceRadius: 2.35
});

const vertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;

  uniform sampler2D uSource;
  uniform sampler2D uLut;
  uniform vec2 uResolution;
  uniform float uShadowRadius;
  uniform float uProgress;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uQuality;
  uniform float uInfluenceRadius;
  uniform vec4 uLensingProfile;

  varying vec2 vUv;

  vec3 sampleChromatic(vec2 uv, vec2 radialDirection, float shiftPx, float amount) {
    vec2 shift = radialDirection * (shiftPx / uResolution);
    vec3 base = texture2D(uSource, clamp(uv, 0.0, 1.0)).rgb;
    vec3 split = vec3(
      texture2D(uSource, clamp(uv - shift, 0.0, 1.0)).r,
      base.g,
      texture2D(uSource, clamp(uv + shift, 0.0, 1.0)).b
    );
    return mix(base, split, amount);
  }

  vec2 rotateDirection(vec2 direction, float angle) {
    float cosine = cos(angle);
    float sine = sin(angle);
    return mat2(cosine, -sine, sine, cosine) * direction;
  }

  void main() {
    vec2 center = vec2(0.5);
    vec2 pixelOffset = (vUv - center) * uResolution;
    float distancePx = length(pixelOffset);
    float currentRadius = mix(1.0, uShadowRadius, uProgress);
    float radiusRatio = distancePx / max(currentRadius, 0.0001);

    if (radiusRatio > uInfluenceRadius || uOpacity <= 0.001) {
      discard;
    }

    if (radiusRatio <= 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, uOpacity);
      return;
    }

    vec2 direction = pixelOffset / max(distancePx, 0.0001);
    float angle = atan(direction.y, direction.x);
    vec4 ray = texture2D(uLut, vec2(clamp(radiusRatio / 4.0, 0.0, 1.0), 0.5));

    float distortionFormation = smoothstep(0.12, 0.62, uProgress);
    float arcFormation = smoothstep(0.36, 0.9, uProgress);
    float settled = smoothstep(0.88, 1.0, uProgress);
    float breathing = sin(uTime * 0.72 + angle * 0.35) * uLensingProfile.w * settled;
    float distortedRatio = mix(radiusRatio, ray.r, distortionFormation * uLensingProfile.x);
    vec2 directUv = center + direction * ((distortedRatio * currentRadius) / uResolution);
    vec2 secondaryUv = center - direction * ((ray.g * currentRadius) / uResolution);

    float horizonZone = exp(-pow((radiusRatio - 1.07) / 0.19, 2.0));
    float arcZone = exp(-pow((radiusRatio - 1.2) / 0.42, 2.0));
    float chromaticAmount = horizonZone * uLensingProfile.z * arcFormation;
    float chromaticShiftPx = mix(0.35, 1.8, horizonZone) * uLensingProfile.z;
    vec3 directColor = sampleChromatic(directUv, direction, chromaticShiftPx, chromaticAmount);
    vec3 secondaryColor = texture2D(uSource, clamp(secondaryUv, 0.0, 1.0)).rgb;
    float secondaryWeight = clamp(ray.b * distortionFormation, 0.0, 0.82);
    vec3 color = mix(directColor, secondaryColor, secondaryWeight);

    // Reprojecta la region que queda geometricamente detras de la sombra.
    // Una fuente centrada forma un anillo; una fuente desplazada forma arcos.
    float hiddenSourceRatio = max(0.0, radiusRatio - 1.0) * 3.15;
    float hiddenSourceRadiusPx = hiddenSourceRatio * currentRadius;
    float hiddenAngularSpread = 0.035 + horizonZone * 0.14;
    vec2 hiddenUvA = center + rotateDirection(direction, hiddenAngularSpread) * (hiddenSourceRadiusPx / uResolution);
    vec2 hiddenUvB = center + rotateDirection(direction, -hiddenAngularSpread) * (hiddenSourceRadiusPx / uResolution);
    vec2 hiddenUvOpposite = center - direction * (hiddenSourceRadiusPx / uResolution);
    vec3 hiddenA = sampleChromatic(hiddenUvA, direction, chromaticShiftPx, chromaticAmount);
    vec3 hiddenB = sampleChromatic(hiddenUvB, direction, chromaticShiftPx, chromaticAmount);
    vec3 hiddenOpposite = texture2D(uSource, clamp(hiddenUvOpposite, 0.0, 1.0)).rgb;
    vec3 hiddenImage = max((hiddenA + hiddenB) * 0.5, hiddenOpposite * 0.72);
    float hiddenImageWeight = horizonZone * arcFormation * uLensingProfile.y;
    color = mix(color, max(color, hiddenImage), clamp(hiddenImageWeight * 0.9, 0.0, 0.86));

    float sourceRadiusPx = distortedRatio * currentRadius;
    float arcAngle = (0.055 + horizonZone * 0.16) * (1.0 + breathing);
    vec2 arcUvA = center + rotateDirection(direction, arcAngle) * (sourceRadiusPx / uResolution);
    vec2 arcUvB = center + rotateDirection(direction, -arcAngle) * (sourceRadiusPx / uResolution);
    vec3 arcA = sampleChromatic(arcUvA, direction, chromaticShiftPx, chromaticAmount);
    vec3 arcB = sampleChromatic(arcUvB, direction, chromaticShiftPx, chromaticAmount);
    vec3 arcMaximum = max(arcA, arcB);
    vec3 arcAverage = (arcA + arcB) * 0.5;

    if (uQuality > 1.5) {
      vec2 arcUvC = center + rotateDirection(direction, arcAngle * 2.15) * (sourceRadiusPx / uResolution);
      vec2 arcUvD = center + rotateDirection(direction, -arcAngle * 2.15) * (sourceRadiusPx / uResolution);
      vec3 arcC = texture2D(uSource, clamp(arcUvC, 0.0, 1.0)).rgb;
      vec3 arcD = texture2D(uSource, clamp(arcUvD, 0.0, 1.0)).rgb;
      arcMaximum = max(arcMaximum, max(arcC, arcD));
      arcAverage = (arcA + arcB + arcC + arcD) * 0.25;
    }

    vec3 arcs = mix(arcAverage, arcMaximum, 0.42);
    arcs = max(arcs, hiddenImage);
    arcs = vec3(1.0) - exp(-arcs * 2.35);
    float arcWeight = arcZone * arcFormation * uLensingProfile.y;
    arcWeight *= uQuality < 0.5 ? 0.0 : 1.0;
    color = mix(color, max(color, arcs), clamp(arcWeight, 0.0, 0.78));

    float compressedLight = ray.a * horizonZone * arcFormation * uLensingProfile.y;
    color = mix(color, max(color, arcs), clamp(compressedLight * 0.72, 0.0, 0.62));

    float edgeFade = 1.0 - smoothstep(max(1.35, uInfluenceRadius - 0.5), uInfluenceRadius, radiusRatio);
    gl_FragColor = vec4(color, edgeFade * uOpacity);
  }
`;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function easeInOutCubic(value) {
  const t = clamp(value, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - clamp(value, 0, 1), 3);
}

function percentile90(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
}

async function loadLut(url) {
  if (!lutRequests.has(url)) {
    lutRequests.set(
      url,
      fetch(url, { cache: "force-cache" }).then(async (response) => {
        if (!response.ok) {
          throw new Error(`No se pudo cargar la LUT Schwarzschild (${response.status}).`);
        }

        const buffer = await response.arrayBuffer();
        const expectedBytes =
          LUT_SAMPLE_COUNT * LUT_CHANNEL_COUNT * Float32Array.BYTES_PER_ELEMENT;
        if (buffer.byteLength !== expectedBytes) {
          throw new Error(`LUT invalida: ${buffer.byteLength} bytes; se esperaban ${expectedBytes}.`);
        }

        const data = new Float32Array(buffer);
        for (const value of data) {
          if (!Number.isFinite(value)) {
            throw new Error("La LUT Schwarzschild contiene valores no finitos.");
          }
        }
        return data;
      })
    );
  }

  return lutRequests.get(url);
}

function makeSnapshot(sourceCanvas) {
  const snapshot = document.createElement("canvas");
  snapshot.width = sourceCanvas.width;
  snapshot.height = sourceCanvas.height;
  const snapshotCtx = snapshot.getContext("2d");
  snapshotCtx.drawImage(sourceCanvas, 0, 0);
  return snapshot;
}

export function createBlackHole(options = {}) {
  return new BlackHole(options);
}

class BlackHole {
  constructor(options = {}) {
    this.type = "black-hole";
    this.state = BLACK_HOLE_STATES.IDLE;
    this.hostElement = options.hostElement || null;
    this.lutUrl = options.lutUrl || "./schwarzschild-lut-v1.bin";
    this.requestedQuality = options.quality || "auto";
    this.activeQuality = this.requestedQuality === "auto" ? "medium" : this.requestedQuality;
    this.lensingProfile = {
      ...DEFAULT_LENSING_PROFILE,
      ...(options.lensingProfile || {})
    };
    this.viewport = { width: 1, height: 1 };
    this.progress = 0;
    this.opacity = 0;
    this.formationStartedAt = 0;
    this.containmentStartedAt = 0;
    this.repairStartedAt = 0;
    this.lastQualityChangeAt = 0;
    this.frameSamples = [];
    this.textureUploads = 0;
    this.fallback = false;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.material = null;
    this.geometry = null;
    this.mesh = null;
    this.sourceTexture = null;
    this.lutTexture = null;
    this.fallbackCanvas = null;
    this.fallbackCtx = null;
    this.fallbackSnapshot = null;
    this.gpuTimer = null;
    this.onStateChange = options.onStateChange || (() => {});
    this.onQualityChange = options.onQualityChange || (() => {});
    this.onContainmentComplete = options.onContainmentComplete || (() => {});
    this.onRepairComplete = options.onRepairComplete || (() => {});
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange(state, this.getStatus());
  }

  getStatus() {
    return {
      state: this.state,
      progress: this.progress,
      opacity: this.opacity,
      quality: this.activeQuality,
      requestedQuality: this.requestedQuality,
      fallback: this.fallback,
      textureUploads: this.textureUploads,
      lensingProfile: { ...this.lensingProfile },
      formationElapsed: this.formationStartedAt ? performance.now() - this.formationStartedAt : 0
    };
  }

  setLensingProfile(settings = {}) {
    const profile = this.lensingProfile;
    if (Number.isFinite(settings.distortion)) profile.distortion = clamp(settings.distortion, 0, 1.5);
    if (Number.isFinite(settings.arcStrength)) profile.arcStrength = clamp(settings.arcStrength, 0, 1.5);
    if (Number.isFinite(settings.chromaticShift)) profile.chromaticShift = clamp(settings.chromaticShift, 0, 1.5);
    if (Number.isFinite(settings.breathing)) profile.breathing = clamp(settings.breathing, 0, 1);
    if (Number.isFinite(settings.influenceRadius)) profile.influenceRadius = clamp(settings.influenceRadius, 1.5, 4);
    this.syncLensingUniforms();
  }

  syncLensingUniforms() {
    if (!this.material) return;
    const profile = this.lensingProfile;
    this.material.uniforms.uLensingProfile.value.set(
      profile.distortion,
      profile.arcStrength,
      profile.chromaticShift,
      profile.breathing
    );
    this.material.uniforms.uInfluenceRadius.value = profile.influenceRadius;
    this.material.uniforms.uQuality.value = QUALITY_ORDER.indexOf(this.activeQuality);
  }

  setQuality(quality) {
    const next = quality === "auto" || QUALITY_SCALES[quality] ? quality : "auto";
    this.requestedQuality = next;
    const active = next === "auto" ? this.activeQuality || "medium" : next;
    this.applyActiveQuality(active);
  }

  applyActiveQuality(quality) {
    const next = QUALITY_SCALES[quality] ? quality : "medium";
    if (this.activeQuality === next && this.renderer) return;
    this.activeQuality = next;
    this.resizeRenderer();
    this.syncLensingUniforms();
    this.onQualityChange(next, this.getStatus());
  }

  async prepare({ sourceCanvas, viewport, quality = this.requestedQuality, hostElement = this.hostElement } = {}) {
    if (!sourceCanvas || !hostElement) {
      throw new Error("BlackHole.prepare requiere sourceCanvas y hostElement.");
    }

    this.releaseRenderResources();
    this.hostElement = hostElement;
    this.viewport = {
      width: Math.max(1, viewport?.width || sourceCanvas.clientWidth || 1),
      height: Math.max(1, viewport?.height || sourceCanvas.clientHeight || 1)
    };
    this.setQuality(quality);
    this.progress = 0;
    this.opacity = 1;
    this.fallback = false;
    this.setState(BLACK_HOLE_STATES.PREPARING);

    try {
      const lutData = await loadLut(this.lutUrl);
      this.createWebGlRenderer(sourceCanvas, lutData);
      this.setState(BLACK_HOLE_STATES.IDLE);
      return { fallback: false };
    } catch (error) {
      console.warn("La anomalia usara el respaldo Canvas 2D:", error);
      this.createFallbackRenderer(sourceCanvas);
      this.fallback = true;
      this.setState(BLACK_HOLE_STATES.FAILED);
      return { fallback: true, error };
    }
  }

  createWebGlRenderer(sourceCanvas, lutData) {
    const rendererCanvas = document.createElement("canvas");
    rendererCanvas.className = "anomaly-webgl-layer";
    const context = rendererCanvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance"
    });

    if (!context) {
      throw new Error("WebGL2 no esta disponible.");
    }

    this.renderer = new THREE.WebGLRenderer({
      canvas: rendererCanvas,
      context,
      alpha: true,
      antialias: false,
      powerPreference: "high-performance"
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;

    const snapshot = makeSnapshot(sourceCanvas);
    this.sourceTexture = new THREE.CanvasTexture(snapshot);
    this.sourceTexture.colorSpace = THREE.SRGBColorSpace;
    this.sourceTexture.minFilter = THREE.LinearFilter;
    this.sourceTexture.magFilter = THREE.LinearFilter;
    this.sourceTexture.generateMipmaps = false;
    this.sourceTexture.needsUpdate = true;
    this.textureUploads += 1;

    this.lutTexture = new THREE.DataTexture(
      new Float32Array(lutData),
      LUT_SAMPLE_COUNT,
      1,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    this.lutTexture.minFilter = THREE.LinearFilter;
    this.lutTexture.magFilter = THREE.LinearFilter;
    this.lutTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.lutTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.lutTexture.generateMipmaps = false;
    this.lutTexture.needsUpdate = true;

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uSource: { value: this.sourceTexture },
        uLut: { value: this.lutTexture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uShadowRadius: { value: 1 },
        uProgress: { value: 0 },
        uOpacity: { value: 1 },
        uTime: { value: 0 },
        uQuality: { value: 1 },
        uInfluenceRadius: { value: this.lensingProfile.influenceRadius },
        uLensingProfile: { value: new THREE.Vector4(
          this.lensingProfile.distortion,
          this.lensingProfile.arcStrength,
          this.lensingProfile.chromaticShift,
          this.lensingProfile.breathing
        ) }
      }
    });
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.hostElement.appendChild(rendererCanvas);
    this.setupGpuTimer(context);
    this.syncLensingUniforms();
    this.resizeRenderer();
  }

  createFallbackRenderer(sourceCanvas) {
    this.fallbackCanvas = document.createElement("canvas");
    this.fallbackCanvas.className = "anomaly-webgl-layer";
    this.fallbackCtx = this.fallbackCanvas.getContext("2d");
    this.fallbackSnapshot = makeSnapshot(sourceCanvas);
    this.hostElement.appendChild(this.fallbackCanvas);
    this.resizeRenderer();
  }

  setupGpuTimer(context) {
    const extension = context.getExtension("EXT_disjoint_timer_query_webgl2");
    this.gpuTimer = extension
      ? { context, extension, active: null, pending: [] }
      : null;
  }

  beginGpuTimer() {
    if (!this.gpuTimer || this.gpuTimer.active) return;
    const query = this.gpuTimer.context.createQuery();
    this.gpuTimer.context.beginQuery(this.gpuTimer.extension.TIME_ELAPSED_EXT, query);
    this.gpuTimer.active = query;
  }

  endGpuTimer() {
    if (!this.gpuTimer?.active) return;
    this.gpuTimer.context.endQuery(this.gpuTimer.extension.TIME_ELAPSED_EXT);
    this.gpuTimer.pending.push(this.gpuTimer.active);
    this.gpuTimer.active = null;
  }

  pollGpuTimer() {
    if (!this.gpuTimer) return;
    const { context, extension, pending } = this.gpuTimer;
    const disjoint = context.getParameter(extension.GPU_DISJOINT_EXT);

    while (pending.length) {
      const query = pending[0];
      const available = context.getQueryParameter(query, context.QUERY_RESULT_AVAILABLE);
      if (!available) break;
      pending.shift();
      if (!disjoint) {
        const nanoseconds = context.getQueryParameter(query, context.QUERY_RESULT);
        this.recordFrameSample(nanoseconds / 1_000_000);
      }
      context.deleteQuery(query);
    }
  }

  getRenderScale() {
    return QUALITY_SCALES[this.activeQuality] || QUALITY_SCALES.medium;
  }

  getFinalShadowRadius() {
    return clamp(Math.min(this.viewport.width, this.viewport.height) * 0.14, 48, 160);
  }

  getCurrentShadowRadius() {
    return 1 + (this.getFinalShadowRadius() - 1) * this.progress;
  }

  resize(viewport) {
    if (viewport) {
      this.viewport = {
        width: Math.max(1, viewport.width || this.viewport.width),
        height: Math.max(1, viewport.height || this.viewport.height)
      };
    }
    this.resizeRenderer();
  }

  resizeRenderer() {
    const scale = this.getRenderScale();
    const renderWidth = Math.max(1, Math.round(this.viewport.width * scale));
    const renderHeight = Math.max(1, Math.round(this.viewport.height * scale));

    if (this.renderer) {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(renderWidth, renderHeight, false);
      this.material?.uniforms.uResolution.value.set(renderWidth, renderHeight);
      this.material.uniforms.uShadowRadius.value = this.getFinalShadowRadius() * scale;
    }

    if (this.fallbackCanvas) {
      this.fallbackCanvas.width = renderWidth;
      this.fallbackCanvas.height = renderHeight;
    }
  }

  startFormation(now = performance.now()) {
    if (!this.renderer && !this.fallbackCanvas) return false;
    this.progress = 0;
    this.opacity = 1;
    this.formationStartedAt = now;
    this.containmentStartedAt = 0;
    this.repairStartedAt = 0;
    this.showLayer();
    this.setState(BLACK_HOLE_STATES.FORMING);
    return true;
  }

  startContainment(now = performance.now()) {
    if (this.state !== BLACK_HOLE_STATES.FORMED) return false;
    this.containmentStartedAt = now;
    this.setState(BLACK_HOLE_STATES.CONTAINING);
    return true;
  }

  requestRepair(now = performance.now()) {
    if (this.state === BLACK_HOLE_STATES.REPAIRING) return false;
    this.progress = Math.max(this.progress, 1);
    this.opacity = 1;
    this.repairStartedAt = now;
    this.showLayer();
    this.setState(BLACK_HOLE_STATES.REPAIRING);
    return true;
  }

  update(now = performance.now()) {
    if (this.state === BLACK_HOLE_STATES.FORMING) {
      const rawProgress = clamp((now - this.formationStartedAt) / FORMATION_DURATION, 0, 1);
      this.progress = easeInOutCubic(rawProgress);
      if (rawProgress >= 1) {
        this.progress = 1;
        this.setState(BLACK_HOLE_STATES.FORMED);
      }
    } else if (this.state === BLACK_HOLE_STATES.CONTAINING) {
      const rawProgress = clamp((now - this.containmentStartedAt) / CONTAINMENT_DURATION, 0, 1);
      this.progress = 1 - easeOutCubic(rawProgress);
      this.opacity = 1 - rawProgress * 0.25;
      if (rawProgress >= 1) {
        this.progress = 0;
        this.opacity = 0;
        this.releaseRenderResources();
        this.setState(BLACK_HOLE_STATES.POSTPONED);
        this.onContainmentComplete(this.getStatus());
      }
    } else if (this.state === BLACK_HOLE_STATES.REPAIRING) {
      const rawProgress = clamp((now - this.repairStartedAt) / REPAIR_DURATION, 0, 1);
      this.progress = 1;
      this.opacity = 1;
      if (rawProgress >= 1) {
        this.releaseRenderResources();
        this.setState(BLACK_HOLE_STATES.IDLE);
        this.onRepairComplete(this.getStatus());
      }
    }

    this.pollGpuTimer();
    this.maybeAdjustQuality(now);
  }

  render() {
    if (this.renderer && this.material && this.scene && this.camera) {
      const before = performance.now();
      const scale = this.getRenderScale();
      const renderWidth = Math.max(1, Math.round(this.viewport.width * scale));
      const renderHeight = Math.max(1, Math.round(this.viewport.height * scale));
      const currentRadius = (1 + (this.getFinalShadowRadius() - 1) * this.progress) * scale;
      const influenceRadius = Math.max(4, currentRadius * this.lensingProfile.influenceRadius);
      const left = clamp(Math.floor(renderWidth * 0.5 - influenceRadius), 0, renderWidth);
      const bottom = clamp(Math.floor(renderHeight * 0.5 - influenceRadius), 0, renderHeight);
      const size = clamp(Math.ceil(influenceRadius * 2), 1, Math.max(renderWidth, renderHeight));

      this.material.uniforms.uProgress.value = this.progress;
      this.material.uniforms.uOpacity.value = this.opacity;
      this.material.uniforms.uTime.value = performance.now() / 1000;
      this.renderer.setScissorTest(false);
      this.renderer.clear();
      this.renderer.setScissorTest(true);
      this.renderer.setScissor(
        left,
        bottom,
        Math.min(size, renderWidth - left),
        Math.min(size, renderHeight - bottom)
      );
      this.beginGpuTimer();
      this.renderer.render(this.scene, this.camera);
      this.endGpuTimer();
      this.renderer.setScissorTest(false);

      if (!this.gpuTimer) {
        this.recordFrameSample(performance.now() - before);
      }
      return;
    }

    this.renderFallback();
  }

  renderFallback() {
    if (!this.fallbackCanvas || !this.fallbackCtx || !this.fallbackSnapshot) return;
    const scale = this.getRenderScale();
    const fallbackCtx = this.fallbackCtx;
    const centerX = this.fallbackCanvas.width * 0.5;
    const centerY = this.fallbackCanvas.height * 0.5;
    const shadowRadius = this.getCurrentShadowRadius() * scale;
    const lensingFormation = easeOutCubic(this.progress);

    fallbackCtx.clearRect(0, 0, this.fallbackCanvas.width, this.fallbackCanvas.height);

    for (let ring = 0; ring < 3; ring += 1) {
      const innerRadius = shadowRadius * (1.02 + ring * 0.14);
      const outerRadius = shadowRadius * (1.2 + ring * 0.26);
      const sourceScale = 1 + (0.08 + ring * 0.035) * lensingFormation;
      fallbackCtx.save();
      fallbackCtx.beginPath();
      fallbackCtx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
      fallbackCtx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2, true);
      fallbackCtx.clip();
      fallbackCtx.globalAlpha = this.opacity * lensingFormation * (0.34 - ring * 0.08);
      fallbackCtx.translate(centerX, centerY);
      fallbackCtx.scale(sourceScale, sourceScale);
      fallbackCtx.translate(-centerX, -centerY);
      fallbackCtx.drawImage(
        this.fallbackSnapshot,
        0,
        0,
        this.fallbackCanvas.width,
        this.fallbackCanvas.height
      );
      fallbackCtx.restore();
    }

    fallbackCtx.globalAlpha = this.opacity;
    fallbackCtx.fillStyle = "#000";
    fallbackCtx.beginPath();
    fallbackCtx.arc(centerX, centerY, shadowRadius, 0, Math.PI * 2);
    fallbackCtx.fill();

    fallbackCtx.globalAlpha = 1;
  }

  recordFrameSample(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
    this.frameSamples.push(milliseconds);
    if (this.frameSamples.length > 90) {
      this.frameSamples.splice(0, this.frameSamples.length - 90);
    }
  }

  maybeAdjustQuality(now) {
    if (
      this.requestedQuality !== "auto" ||
      this.frameSamples.length < 20 ||
      now - this.lastQualityChangeAt < 1000
    ) {
      return;
    }

    const p90 = percentile90(this.frameSamples);
    const currentIndex = QUALITY_ORDER.indexOf(this.activeQuality);
    let nextIndex = currentIndex;

    if (p90 > 12 && currentIndex > 0) {
      nextIndex -= 1;
    } else if (p90 < 6 && currentIndex < QUALITY_ORDER.length - 1) {
      nextIndex += 1;
    }

    if (nextIndex !== currentIndex) {
      this.lastQualityChangeAt = now;
      this.frameSamples.length = 0;
      this.applyActiveQuality(QUALITY_ORDER[nextIndex]);
    }
  }

  showLayer() {
    const layer = this.renderer?.domElement || this.fallbackCanvas;
    if (layer) layer.hidden = false;
  }

  reset() {
    this.releaseRenderResources();
    this.progress = 0;
    this.opacity = 0;
    this.formationStartedAt = 0;
    this.containmentStartedAt = 0;
    this.repairStartedAt = 0;
    this.fallback = false;
    this.setState(BLACK_HOLE_STATES.IDLE);
  }

  releaseRenderResources() {
    if (this.gpuTimer) {
      const { context, pending, active } = this.gpuTimer;
      if (active) context.deleteQuery(active);
      for (const query of pending) context.deleteQuery(query);
    }
    this.gpuTimer = null;
    this.sourceTexture?.dispose();
    this.lutTexture?.dispose();
    this.material?.dispose();
    this.geometry?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.fallbackCanvas?.remove();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.material = null;
    this.geometry = null;
    this.mesh = null;
    this.sourceTexture = null;
    this.lutTexture = null;
    this.fallbackCanvas = null;
    this.fallbackCtx = null;
    this.fallbackSnapshot = null;
  }

  dispose() {
    this.reset();
  }

  drawStage() {
    // Conservado para que el objeto pueda seguir integrado por etapas en futuras pruebas Canvas 2D.
  }
}
