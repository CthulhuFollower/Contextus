import * as THREE from "three";

// Version desacoplada del motor de estrella animada:
// - paleta de colores por tipo espectral
// - shader procedural para la superficie
// - glow billboard
// - corona exterior separada

export const COLORES_TIPO_ESTRELLA = Object.freeze({
  "": [[1, 1, 0.65], [1, 0.9, 0.2]],
  Unknown: [[1, 1, 0.65], [1, 0.9, 0.2]],
  A: [[1, 1, 1], [0.8, 0.8, 1]],
  B: [[0.8, 0.9, 1], [0.65, 0.65, 1]],
  F: [[1, 0.9, 0.7], [0.85, 0.75, 0.3]],
  G: [[1, 1, 0.65], [1, 0.9, 0.2]],
  K: [[1, 1, 0.4], [0.8, 0.5, 0.2]],
  L: [[0.75, 0.2, 0], [0.4, 0.2, 0]],
  M: [[0.9, 0.2, 0], [0.5, 0.1, 0]],
  O: [[0.9, 0.9, 1], [0.65, 0.65, 1]],
  S: [[1, 0.7, 0.2], [0.75, 0.35, 0.2]],
  T: [[0.8, 0.4, 0.2], [0.2, 0.1, 0.2]],
  W: [[1, 1, 0.65], [1, 0.9, 0.2]],
  Y: [[0.31, 0.17, 0.07], [0.15, 0.09, 0.03]],
  WD: [[0.945, 0.945, 1], [0.784, 0.847, 1]]
});

export const TIPOS_ESTRELLA = Object.freeze(
  Object.keys(COLORES_TIPO_ESTRELLA).filter(Boolean)
);

export const ASSETS_ESTRELLA = Object.freeze({
  surfaceTextureUrl: null,
  glowTextureUrl: null
});

const SURFACE_VERTEX_SHADER = `
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

void main() {
  vUv = uv;

  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir = cameraPosition - worldPosition.xyz;

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const SURFACE_FRAGMENT_SHADER = `
uniform sampler2D surfaceTexture;

uniform float perlinGain;
uniform float perlinAmplitude;
uniform float perlinLacunarity;
uniform float perlinDensity;
uniform float noiseMult;
uniform float perlinVelocity;
uniform float wallTime;
uniform float animationSpeed;

uniform vec3 colorBright;
uniform vec3 colorDark;

varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

#define M_PI 3.1415926535897

vec4 permute1(vec4 x) {
  return mod((x * 125.0 + 13.0) * x, 155.0);
}

float PerlinNoise(vec3 P) {
  vec3 Pi0 = floor(P);
  vec3 Pi1 = Pi0 + vec3(1.0);
  Pi0 = mod(Pi0, 255.0);
  Pi1 = mod(Pi1, 255.0);
  vec3 Pf0 = fract(P);
  vec3 Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz;
  vec4 iz1 = Pi1.zzzz;

  vec4 ixy = permute1(permute1(ix) + iy);
  vec4 ixy0 = permute1(ixy + iz0);
  vec4 ixy1 = permute1(ixy + iz1);

  vec4 gx0 = ixy0 * (1.0 / 7.0);
  vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5);
  gy0 -= sz0 * (step(0.0, gy0) - 0.5);

  vec4 gx1 = ixy1 * (1.0 / 7.0);
  vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5);
  gy1 -= sz1 * (step(0.0, gy1) - 0.5);

  vec3 g000 = vec3(gx0.x, gy0.x, gz0.x);
  vec3 g100 = vec3(gx0.y, gy0.y, gz0.y);
  vec3 g010 = vec3(gx0.z, gy0.z, gz0.z);
  vec3 g110 = vec3(gx0.w, gy0.w, gz0.w);
  vec3 g001 = vec3(gx1.x, gy1.x, gz1.x);
  vec3 g101 = vec3(gx1.y, gy1.y, gz1.y);
  vec3 g011 = vec3(gx1.z, gy1.z, gz1.z);
  vec3 g111 = vec3(gx1.w, gy1.w, gz1.w);

  float n000 = dot(g000, Pf0);
  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
  float n111 = dot(g111, Pf1);

  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), Pf0.z);
  vec2 n_yz = mix(n_z.xy, n_z.zw, Pf0.y);
  float n_xyz = mix(n_yz.x, n_yz.y, Pf0.x);
  return 3.5 * n_xyz;
}

float fbm(vec3 P) {
  float sum = 0.0;
  float amplitude = perlinAmplitude;

  for (int i = 0; i < 3; i++) {
    amplitude *= perlinGain;
    sum += amplitude * PerlinNoise(P);
    P *= perlinLacunarity;
  }

  return sum;
}

float pattern(vec3 p) {
  float time = wallTime * perlinVelocity * animationSpeed;

  vec3 q;
  q.x = fbm(p + vec3(3.7 * time, 2.7 * time, -1.7 * time));
  q.y = q.x;
  q.z = q.x;

  vec3 r;
  r.x = fbm(p + 4.0 * q + vec3(1.3 * time, -2.3 * time, 3.3 * time));
  r.y = r.x;
  r.z = r.x;

  return fbm(p + 4.0 * r);
}

vec4 noise(float m) {
  float theta = 2.0 * M_PI * vUv.x;
  float phi = M_PI * vUv.y;

  float _x = cos(theta) * sin(phi);
  float _y = sin(theta) * sin(phi);
  float _z = -cos(phi);

  vec3 spatialPosition = vec3(_x, _y, _z);
  float color = pattern(spatialPosition * perlinDensity);
  vec4 c = vec4(color, color, color, 1.0);
  c *= noiseMult / max(m, 0.25);

  return c;
}

void main() {
  vec4 baseTexture = texture2D(surfaceTexture, vUv);
  vec4 ret = noise(length(baseTexture.rgb));

  vec3 colorPixel = colorBright * ret.r + (1.0 - ret.r) * colorDark;
  colorPixel *= mix(0.78, 1.16, baseTexture.r);

  float viewDot = max(dot(normalize(vWorldNormal), normalize(vViewDir)), 0.0);
  float rim = pow(1.0 - viewDot, 2.4);
  colorPixel += colorBright * rim * 0.25;

  float pulse = 0.965 + 0.035 * sin(wallTime * 0.9);
  gl_FragColor = vec4(colorPixel * pulse, 1.0);
}
`;

const GLOW_VERTEX_SHADER = `
uniform vec2 size;

varying vec2 fUV;

void main() {
  vec4 viewPosition = modelViewMatrix * vec4(position.x * size.x, position.y * size.y, 0.0, 1.0);
  gl_Position = projectionMatrix * viewPosition;
  fUV = uv;
}
`;

const GLOW_FRAGMENT_SHADER = `
uniform vec4 colorMultiplier;
uniform float alphaMultiplier;
uniform sampler2D colorTexture;

varying vec2 fUV;

void main() {
  gl_FragColor = texture2D(colorTexture, fUV);
  gl_FragColor *= colorMultiplier;
  gl_FragColor.a *= alphaMultiplier;
}
`;

const CORONA_VERTEX_SHADER = `
varying vec3 vWorldNormal;
varying vec3 vViewDir;
varying vec3 vObjectPosition;

void main() {
  vObjectPosition = position;

  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir = cameraPosition - worldPosition.xyz;

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const CORONA_FRAGMENT_SHADER = `
uniform vec3 color;
uniform float density;
uniform float emissivity;
uniform float wallTime;
uniform float animationSpeed;

varying vec3 vWorldNormal;
varying vec3 vViewDir;
varying vec3 vObjectPosition;

float coronaNoise(vec3 p) {
  float t = wallTime * 0.35 * animationSpeed;
  float wave1 = sin(p.y * 18.0 + t);
  float wave2 = sin(p.x * 24.0 - t * 1.2);
  float wave3 = sin((p.z + p.x) * 14.0 + t * 0.8);
  return 0.5 + 0.5 * (wave1 * 0.45 + wave2 * 0.35 + wave3 * 0.2);
}

void main() {
  vec3 normalDir = normalize(vWorldNormal);
  vec3 viewDir = normalize(vViewDir);

  float fresnel = pow(1.0 - max(dot(normalDir, viewDir), 0.0), 1.7);
  float wisps = mix(0.72, 1.18, coronaNoise(normalize(vObjectPosition)));
  float alpha = clamp(pow(fresnel, 0.9) * density * wisps, 0.0, 1.0);

  vec3 coronaColor = color * emissivity * (0.7 + 1.6 * fresnel) * wisps;
  gl_FragColor = vec4(coronaColor, alpha);
}
`;

function toColor(value) {
  if (value instanceof THREE.Color) {
    return value.clone();
  }

  if (Array.isArray(value)) {
    return new THREE.Color(value[0], value[1], value[2]);
  }

  return new THREE.Color(value ?? 0xffffff);
}

function getStarColors(starType) {
  const colors = COLORES_TIPO_ESTRELLA[starType] || COLORES_TIPO_ESTRELLA.Unknown;

  return {
    bright: toColor(colors[0]),
    dark: toColor(colors[1])
  };
}

function createFallbackSurfaceTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;

  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#dfdfdf");
  gradient.addColorStop(0.35, "#909090");
  gradient.addColorStop(0.65, "#f4f4f4");
  gradient.addColorStop(1, "#7a7a7a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < canvas.height; y += 1) {
    const band = 140 + Math.sin(y * 0.055) * 30 + Math.sin(y * 0.17) * 20;
    ctx.fillStyle = `rgba(${band}, ${band}, ${band}, 0.18)`;
    ctx.fillRect(0, y, canvas.width, 1);
  }

  for (let i = 0; i < 1800; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const radius = 1 + Math.random() * 10;
    const alpha = 0.025 + Math.random() * 0.03;
    const tone = 170 + Math.floor(Math.random() * 70);
    const blob = ctx.createRadialGradient(x, y, 0, x, y, radius);
    blob.addColorStop(0, `rgba(${tone}, ${tone}, ${tone}, ${alpha})`);
    blob.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = blob;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createFallbackGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;

  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.18, "rgba(255, 244, 214, 0.95)");
  gradient.addColorStop(0.48, "rgba(255, 194, 116, 0.5)");
  gradient.addColorStop(0.76, "rgba(255, 120, 30, 0.16)");
  gradient.addColorStop(1, "rgba(255, 120, 30, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

async function loadTextureOrFallback(url, fallbackFactory) {
  if (!url) {
    return {
      texture: fallbackFactory(),
      fallbackUsed: true
    };
  }

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");

  try {
    const texture = await loader.loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    return {
      texture,
      fallbackUsed: false
    };
  } catch (error) {
    return {
      texture: fallbackFactory(),
      fallbackUsed: true
    };
  }
}

export class EstrellaAnimada {
  constructor(options = {}) {
    this.options = {
      radius: options.radius ?? 1.15,
      starType: options.starType ?? "G",
      glowScale: options.glowScale ?? 5,
      coronaScale: options.coronaScale ?? 1.26,
      rotationSpeed: options.rotationSpeed ?? 0.01,
      axialTilt: options.axialTilt ?? 50,
      animationSpeed: options.animationSpeed ?? 1,
      surfaceTextureUrl: options.surfaceTextureUrl ?? ASSETS_ESTRELLA.surfaceTextureUrl,
      glowTextureUrl: options.glowTextureUrl ?? ASSETS_ESTRELLA.glowTextureUrl
    };

    this.object3d = new THREE.Group();
    this.object3d.name = "estrella-animada";
    this.object3d.userData.animatedStar = this;
    this.usedFallbackAssets = false;

    const colors = getStarColors(this.options.starType);

    this.surfaceMaterial = new THREE.ShaderMaterial({
      uniforms: {
        surfaceTexture: new THREE.Uniform(createFallbackSurfaceTexture()),
        perlinGain: new THREE.Uniform(0.36),
        perlinAmplitude: new THREE.Uniform(1),
        perlinLacunarity: new THREE.Uniform(5.2),
        perlinDensity: new THREE.Uniform(4.7),
        noiseMult: new THREE.Uniform(3),
        perlinVelocity: new THREE.Uniform(0.015),
        wallTime: new THREE.Uniform(0),
        animationSpeed: new THREE.Uniform(this.options.animationSpeed),
        colorBright: new THREE.Uniform(colors.bright),
        colorDark: new THREE.Uniform(colors.dark)
      },
      vertexShader: SURFACE_VERTEX_SHADER,
      fragmentShader: SURFACE_FRAGMENT_SHADER
    });

    this.coreMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 160, 112),
      this.surfaceMaterial
    );
    this.coreMesh.name = "estrella-superficie";

    this.coreSpinGroup = new THREE.Group();
    this.coreSpinGroup.name = "estrella-superficie-spin";

    this.coreTiltGroup = new THREE.Group();
    this.coreTiltGroup.name = "estrella-superficie-tilt";
    this.coreSpinGroup.add(this.coreMesh);
    this.coreTiltGroup.add(this.coreSpinGroup);

    this.glowMaterial = new THREE.ShaderMaterial({
      uniforms: {
        colorMultiplier: new THREE.Uniform(new THREE.Vector4(colors.bright.r, colors.bright.g, colors.bright.b, 1)),
        alphaMultiplier: new THREE.Uniform(1),
        size: new THREE.Uniform(new THREE.Vector2(1, 1)),
        colorTexture: new THREE.Uniform(createFallbackGlowTexture())
      },
      vertexShader: GLOW_VERTEX_SHADER,
      fragmentShader: GLOW_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending
    });

    this.glowMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      this.glowMaterial
    );
    this.glowMesh.name = "estrella-glow";
    this.glowMesh.renderOrder = 3;
    this.glowMesh.frustumCulled = false;

    this.coronaMaterial = new THREE.ShaderMaterial({
      uniforms: {
        color: new THREE.Uniform(colors.dark),
        density: new THREE.Uniform(0.92),
        emissivity: new THREE.Uniform(1),
        wallTime: new THREE.Uniform(0),
        animationSpeed: new THREE.Uniform(this.options.animationSpeed)
      },
      vertexShader: CORONA_VERTEX_SHADER,
      fragmentShader: CORONA_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending
    });

    this.coronaMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 128, 96),
      this.coronaMaterial
    );
    this.coronaMesh.name = "estrella-corona";
    this.coronaMesh.renderOrder = 2;

    this.object3d.add(this.coronaMesh);
    this.object3d.add(this.coreTiltGroup);
    this.object3d.add(this.glowMesh);

    this.setRadius(this.options.radius);
    this.setAxialTilt(this.options.axialTilt);
    this.setStarType(this.options.starType);
    this.ready = this._loadAssets();
  }

  async _loadAssets() {
    const [surfaceResult, glowResult] = await Promise.all([
      loadTextureOrFallback(this.options.surfaceTextureUrl, createFallbackSurfaceTexture),
      loadTextureOrFallback(this.options.glowTextureUrl, createFallbackGlowTexture)
    ]);

    const previousSurfaceTexture = this.surfaceMaterial.uniforms.surfaceTexture.value;
    const previousGlowTexture = this.glowMaterial.uniforms.colorTexture.value;
    const surfaceTexture = surfaceResult.texture;
    const glowTexture = glowResult.texture;

    this.usedFallbackAssets = surfaceResult.fallbackUsed || glowResult.fallbackUsed;
    surfaceTexture.wrapS = THREE.RepeatWrapping;
    surfaceTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.surfaceMaterial.uniforms.surfaceTexture.value = surfaceTexture;
    this.surfaceMaterial.needsUpdate = true;

    this.glowMaterial.uniforms.colorTexture.value = glowTexture;
    this.glowMaterial.needsUpdate = true;

    if (previousSurfaceTexture !== surfaceTexture) {
      previousSurfaceTexture?.dispose?.();
    }

    if (previousGlowTexture !== glowTexture) {
      previousGlowTexture?.dispose?.();
    }
  }

  setStarType(starType) {
    this.options.starType = starType;

    const { bright, dark } = getStarColors(starType);
    this.surfaceMaterial.uniforms.colorBright.value.copy(bright);
    this.surfaceMaterial.uniforms.colorDark.value.copy(dark);
    this.glowMaterial.uniforms.colorMultiplier.value.set(bright.r, bright.g, bright.b, 1);
    this.coronaMaterial.uniforms.color.value.copy(dark);
  }

  setRadius(radius) {
    this.options.radius = Math.max(radius, 0.01);

    this.coreMesh.scale.setScalar(this.options.radius);
    this.coronaMesh.scale.setScalar(this.options.radius * this.options.coronaScale);
    this.glowMaterial.uniforms.size.value.set(
      this.options.radius * this.options.glowScale,
      this.options.radius * this.options.glowScale
    );
  }

  setAnimationSpeed(speed) {
    this.options.animationSpeed = Math.max(speed, 0);
    this.surfaceMaterial.uniforms.animationSpeed.value = this.options.animationSpeed;
    this.coronaMaterial.uniforms.animationSpeed.value = this.options.animationSpeed;
  }

  setRotationSpeed(speed) {
    this.options.rotationSpeed = speed;
  }

  setAxialTilt(degrees) {
    this.options.axialTilt = degrees;
    this.coreTiltGroup.rotation.z = THREE.MathUtils.degToRad(degrees);
  }

  setGlowVisible(visible) {
    this.glowMesh.visible = visible;
  }

  setCoronaVisible(visible) {
    this.coronaMesh.visible = visible;
  }

  update(timeSeconds, camera) {
    const wallTime = timeSeconds % 1000;
    this.surfaceMaterial.uniforms.wallTime.value = wallTime;
    this.coronaMaterial.uniforms.wallTime.value = wallTime;
    this.coreSpinGroup.rotation.y = timeSeconds * this.options.rotationSpeed;

    if (camera) {
      this.glowMesh.quaternion.copy(camera.quaternion);
    }
  }

  dispose() {
    this.coreMesh.geometry.dispose();
    this.coronaMesh.geometry.dispose();
    this.glowMesh.geometry.dispose();

    const surfaceTexture = this.surfaceMaterial.uniforms.surfaceTexture.value;
    const glowTexture = this.glowMaterial.uniforms.colorTexture.value;

    this.surfaceMaterial.dispose();
    this.glowMaterial.dispose();
    this.coronaMaterial.dispose();

    surfaceTexture?.dispose?.();
    glowTexture?.dispose?.();
  }
}

export async function crearEstrellaAnimada(options = {}) {
  const estrella = new EstrellaAnimada(options);
  await estrella.ready;
  return estrella;
}
