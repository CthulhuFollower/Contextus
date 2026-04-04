import * as THREE from "three";

// Extraido del starfield de nasa codigo.js, principalmente del bloque
// alrededor de las lineas 90335-90669. La idea es preservar la receta
// visual y de fade, pero sin el motor propietario que envuelve al bundle.

const DEFAULT_POINT_SIZE_BASE = 35.0;
const DEFAULT_POINT_CUTOFF = 6e15;

const VERTEX_SHADER = `
attribute float alpha;
attribute float planet;
attribute float showHWO;

varying vec4 vColor;
varying float count;
varying float renderHWO;

void main() {
  vColor = vec4(color, alpha);
  count = round(planet);
  renderHWO = showHWO;

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float pointSizeBase = ${DEFAULT_POINT_SIZE_BASE.toFixed(1)};
  float pointCutoff = ${DEFAULT_POINT_CUTOFF.toFixed(1)};
  float ratio = length(mvPosition.xyz) / pointCutoff;
  gl_PointSize = pointSizeBase * clamp(exp(1.0 - ratio), 1.0, 64.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT_SHADER = `
uniform sampler2D starTexture;

varying vec4 vColor;
varying float count;
varying float renderHWO;

vec2 getCoordinates() {
  float roundedCount = round(count);
  float offsetX = mod(roundedCount, 4.0) / 4.0;
  float offsetY = 3.0 / 4.0 - floor(roundedCount / 4.0) / 4.0;

  vec2 coord = vec2(gl_PointCoord.x / 4.0 + offsetX, gl_PointCoord.y / 4.0 + offsetY);
  coord.x = clamp(coord.x, 0.0, 1.0);
  coord.y = clamp(coord.y, 0.0, 1.0);

  return coord;
}

void main() {
  vec4 clr = texture2D(starTexture, getCoordinates());
  gl_FragColor = vec4(vColor.rgb, vColor.a * clr.r);

  if (renderHWO > 0.0) {
    gl_FragColor = vec4(vColor.rgb, vColor.a * clr.g);
  }
}
`;

function isEmptyObject(value) {
  return !value || Object.keys(value).length === 0;
}

function asVector3(value) {
  if (value instanceof THREE.Vector3) {
    return value.clone();
  }

  if (Array.isArray(value)) {
    return new THREE.Vector3(value[0] || 0, value[1] || 0, value[2] || 0);
  }

  return new THREE.Vector3(value?.x || 0, value?.y || 0, value?.z || 0);
}

function asColorArray(value) {
  if (Array.isArray(value) && value.length >= 3) {
    return [value[0], value[1], value[2]];
  }

  if (typeof value === "string") {
    const color = new THREE.Color(value);
    return [color.r, color.g, color.b];
  }

  if (value && typeof value === "object") {
    if ("r" in value && "g" in value && "b" in value) {
      return [value.r, value.g, value.b];
    }
  }

  return [1, 1, 1];
}

function drawBlob(ctx, x, y, radius, color, alpha = 1) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`);
  gradient.addColorStop(0.55, `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha * 0.5})`);
  gradient.addColorStop(1, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0)`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function createFallbackTwinkleAtlas() {
  const size = 256;
  const cells = 4;
  const cell = size / cells;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  for (let row = 0; row < cells; row += 1) {
    for (let col = 0; col < cells; col += 1) {
      const left = col * cell;
      const top = row * cell;
      const cx = left + cell / 2;
      const cy = top + cell / 2;
      const radius = cell * (0.16 + ((row * cells + col) % 5) * 0.035);

      drawBlob(ctx, cx, cy, radius * 1.7, [255, 255, 255], 0.18);
      drawBlob(ctx, cx, cy, radius, [255, 255, 255], 0.9);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function createFallbackNumberAtlas() {
  const size = 256;
  const cells = 4;
  const cell = size / cells;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 34px Arial";

  for (let row = 0; row < cells; row += 1) {
    for (let col = 0; col < cells; col += 1) {
      const index = row * cells + col;
      const left = col * cell;
      const top = row * cell;
      const cx = left + cell / 2;
      const cy = top + cell / 2;

      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.27, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.22, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "rgba(255,255,255,0.94)";
      ctx.fillText(String(index), cx, cy + 1);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

export class NasaStarfieldCore {
  constructor({
    scene,
    textureLoader = new THREE.TextureLoader(),
    spriteTextureUrls = {},
    fieldName = "ExoMainstarfield",
    visualBasedDiscovery = true
  } = {}) {
    if (!scene) {
      throw new Error("NasaStarfieldCore necesita un scene de THREE.");
    }

    this.scene = scene;
    this.textureLoader = textureLoader;
    this.spriteTextureUrls = spriteTextureUrls;
    this.fieldName = fieldName;
    this.visualBasedDiscovery = visualBasedDiscovery;

    this.starDB = {};
    this.planetDB = {};
    this.currentStarDB = {};
    this.currentPlanetDB = {};
    this.planetDiscovery = [0, 0];

    this.points = null;
    this.material = null;
    this.geometry = null;
    this.texture = null;

    this._alpha = [];
    this._dates = [];
    this._visibleStars = [];
    this._visibleStarKeys = [];
    this._interactable = true;
    this._clickable = false;
    this._selectedStarIndex = null;
    this._fadeFrame = null;
    this._onSelect = null;

    this._screenPos = new THREE.Vector3();
  }

  init(starDB, planetDB = {}, onSelect) {
    this.starDB = starDB || {};
    this.planetDB = planetDB || {};
    this._onSelect = onSelect || null;
    this.setFilter(null, 0);
    this.setStarSprite(0);
    return this;
  }

  dispose() {
    if (this._fadeFrame) {
      cancelAnimationFrame(this._fadeFrame);
      this._fadeFrame = null;
    }

    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.points = null;
    }

    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }

    this.geometry = null;
    this.material = null;
  }

  setInteractable(value) {
    this._interactable = Boolean(value);
  }

  get planetCount() {
    return isEmptyObject(this.currentPlanetDB) ? 0 : Object.keys(this.currentPlanetDB).length;
  }

  setFilter(filters = null, alphaValue = null) {
    this.currentStarDB = { ...this.starDB };
    this.currentPlanetDB = { ...this.planetDB };

    let updateDiscoveryRange = true;
    this.planetDiscovery = [0, 0];
    const positions = [];
    const colors = [];
    const planets = [];
    const alpha = [];
    const dates = [];
    const hwoFlags = [];

    let hwoMode = false;

    if (filters && filters !== "all") {
      const nextStars = {};
      const nextPlanets = {};

      for (let i = 0; i < filters.length; i += 1) {
        const filter = filters[i];

        if (filter.db === "planets") {
          const planetKeys = this.planetDB ? Object.keys(this.planetDB) : [];
          for (let p = 0; p < planetKeys.length; p += 1) {
            const planet = this.planetDB[planetKeys[p]];
            if (!planet) {
              continue;
            }

            const fieldValue = planet[filter.field];
            let matches = false;
            if (filter.op === "=") {
              matches = fieldValue === filter.value;
            } else if (typeof fieldValue === "string" && typeof filter.value === "string") {
              matches = fieldValue.indexOf(filter.value) >= 0;
            }

            if (
              typeof fieldValue === "string" &&
              typeof filter.value === "string" &&
              filter.value.indexOf("Kepler") >= 0 &&
              filter.value.indexOf("K2") >= 0
            ) {
              matches = fieldValue.indexOf("Kepler") >= 0 || fieldValue.indexOf("K2") >= 0;
            }

            if (!matches) {
              continue;
            }

            updateDiscoveryRange = false;
            this.planetDiscovery[0] =
              !this.planetDiscovery[0] || this.planetDiscovery[0] > planet.date
                ? planet.date
                : this.planetDiscovery[0];
            this.planetDiscovery[1] =
              !this.planetDiscovery[1] || this.planetDiscovery[1] < planet.date
                ? planet.date
                : this.planetDiscovery[1];

            nextStars[planet.pl_hostname] = this.starDB[planet.pl_hostname];
            nextPlanets[planet.exo_id] = planet;
          }
        } else if (filter.db === "stars") {
          const starKeys = this.starDB ? Object.keys(this.starDB) : [];
          for (let s = 0; s < starKeys.length; s += 1) {
            const star = this.starDB[starKeys[s]];
            if (!star) {
              continue;
            }

            const fieldValue = star[filter.field];
            let matches = false;
            if (filter.op === "=") {
              matches = fieldValue === filter.value;
              if (filter.field === "hwo" && matches) {
                hwoMode = true;
                nextStars[star.exo_id] = star;
              }
            } else if (typeof fieldValue === "string" && typeof filter.value === "string") {
              matches = fieldValue.indexOf(filter.value) >= 0;
            }

            const planet = this.planetDB ? this.planetDB[star.planets?.[0]] : null;
            if (!matches || !planet) {
              continue;
            }

            updateDiscoveryRange = false;
            this.planetDiscovery[0] =
              !this.planetDiscovery[0] || this.planetDiscovery[0] > planet.date
                ? planet.date
                : this.planetDiscovery[0];
            this.planetDiscovery[1] =
              !this.planetDiscovery[1] || this.planetDiscovery[1] < planet.date
                ? planet.date
                : this.planetDiscovery[1];

            nextStars[star.exo_id] = star;
          }
        }
      }

      this.currentStarDB = nextStars;
      this.currentPlanetDB = nextPlanets;
    }

    const starKeys = this.currentStarDB ? Object.keys(this.currentStarDB) : [];
    this._visibleStars = [];
    this._visibleStarKeys = [];

    for (let i = 0; i < starKeys.length; i += 1) {
      const star = this.currentStarDB[starKeys[i]];
      if (!star) {
        continue;
      }

      let isVisible = Boolean(star.position && star.position[0] !== -1);
      if (!hwoMode && this.fieldName === "ExoMainstarfield") {
        isVisible = isVisible && Boolean(star.planets?.length > 0);
      }

      if (!isVisible) {
        continue;
      }

      const position = asVector3(star.positionJ2000);
      const color = asColorArray(star.color);

      positions.push(position.x, position.y, position.z);
      colors.push(color[0], color[1], color[2]);

      if (this.visualBasedDiscovery && this.planetDB) {
        let firstDiscoveryDate = null;
        for (let p = 0; p < (star.planets?.length || 0); p += 1) {
          const planet = this.planetDB[star.planets[p]];
          if (!planet || firstDiscoveryDate) {
            continue;
          }

          if (updateDiscoveryRange) {
            const parsedDate = planet.date ? parseInt(planet.date, 10) : 0;
            this.planetDiscovery[0] =
              !this.planetDiscovery[0] || this.planetDiscovery[0] > parsedDate
                ? parsedDate
                : this.planetDiscovery[0];
            this.planetDiscovery[1] =
              !this.planetDiscovery[1] || this.planetDiscovery[1] < parsedDate
                ? parsedDate
                : this.planetDiscovery[1];
          }

          firstDiscoveryDate = planet.date ? parseInt(planet.date, 10) : null;
        }

        dates.push(firstDiscoveryDate);
        alpha.push(0);
      } else {
        dates.push(null);
        alpha.push(alphaValue !== null ? alphaValue : 1);
      }

      planets.push(star.planets?.length || 0);
      hwoFlags.push(hwoMode && star.hwo ? 1 : 0);
      this._visibleStars.push(star);
      this._visibleStarKeys.push(starKeys[i]);
    }

    this._rebuildPoints({ positions, colors, planets, alpha, dates, hwoFlags });
    return this;
  }

  _rebuildPoints({ positions, colors, planets, alpha, dates, hwoFlags }) {
    this._alpha = alpha.slice();
    this._dates = dates.slice();

    if (!this.texture) {
      this.texture = createFallbackTwinkleAtlas();
    }

    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    this.geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    this.geometry.setAttribute("planet", new THREE.Float32BufferAttribute(planets, 1));

    const alphaAttribute = new THREE.Float32BufferAttribute(alpha, 1);
    alphaAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("alpha", alphaAttribute);
    this.geometry.setAttribute("showHWO", new THREE.Float32BufferAttribute(hwoFlags, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        starTexture: { value: this.texture }
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      blending: THREE.CustomBlending,
      blendDst: THREE.DstAlphaFactor
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = `Exostars_${this.fieldName}`;
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  setStarSprite(mode = 0) {
    const url = this.spriteTextureUrls[mode];

    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }

    if (url) {
      this.texture = this.textureLoader.load(url, texture => {
        texture.flipY = false;
        if (this.material) {
          this.material.uniforms.starTexture.value = texture;
        }
      });
      this.texture.flipY = false;
    } else {
      this.texture = mode === 1 ? createFallbackNumberAtlas() : createFallbackTwinkleAtlas();
    }

    if (this.material) {
      this.material.uniforms.starTexture.value = this.texture;
      this.material.needsUpdate = true;
    }

    return this;
  }

  starFade(show, duration = 2000) {
    if (!this.points || !this.currentStarDB || !this.currentPlanetDB) {
      return this;
    }

    const alphaAttribute = this.points.geometry.getAttribute("alpha");
    const minYear = this.planetDiscovery[0];
    const maxYear = this.planetDiscovery[1];
    const span = maxYear - minYear;

    if (this._fadeFrame) {
      cancelAnimationFrame(this._fadeFrame);
      this._fadeFrame = null;
    }

    const from = show ? 0 : 1;
    const to = show ? 1 : 0;
    const start = performance.now();

    const step = now => {
      const progress = duration <= 0 ? 1 : Math.min((now - start) / duration, 1);
      const value = THREE.MathUtils.lerp(from, to, progress);
      let thresholdYear = show
        ? minYear * (1 - value) + (maxYear + span) * value
        : (minYear - span) * (1 - value) + maxYear * value;
      thresholdYear = Math.round(thresholdYear);

      for (let i = 0; i < this._dates.length; i += 1) {
        let alwaysVisible = this._dates[i] === null || this._dates[i] === undefined;
        if (this.planetDiscovery && minYear && maxYear) {
          if (maxYear - minYear === 0) {
            alwaysVisible = true;
          }
        } else {
          alwaysVisible = true;
        }

        if (alwaysVisible) {
          this._alpha[i] = show
            ? this._alpha[i] > value
              ? this._alpha[i]
              : value
            : this._alpha[i] < value
              ? this._alpha[i]
              : value;
        } else if (show) {
          if (this._dates[i] <= thresholdYear) {
            const ratio = (this._dates[i] - minYear) / (maxYear - minYear);
            const nextAlpha = ratio === 0 ? 1 : (2 * value - ratio) / ratio;
            if (this._alpha[i] < nextAlpha) {
              this._alpha[i] = nextAlpha;
            }
          }
        } else if (this._dates[i] >= thresholdYear) {
          const ratio = (maxYear - this._dates[i]) / (maxYear - minYear);
          const nextAlpha = ratio === 0 ? 0 : 1 - (1 - value) / ratio;
          if (this._alpha[i] > nextAlpha) {
            this._alpha[i] = nextAlpha;
          }
        }

        this._alpha[i] = THREE.MathUtils.clamp(this._alpha[i], 0, 1);
        alphaAttribute.array[i] = this._alpha[i];
      }

      alphaAttribute.needsUpdate = true;

      if (progress < 1) {
        this._fadeFrame = requestAnimationFrame(step);
      } else {
        this._fadeFrame = null;
        this._clickable = show;
      }
    };

    this._fadeFrame = requestAnimationFrame(step);
    return this;
  }

  pick(clientX, clientY, camera, renderer) {
    if (!this.points || !camera || !renderer || !this._clickable || !this._interactable) {
      return null;
    }

    const width = renderer.domElement.clientWidth;
    const height = renderer.domElement.clientHeight;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestIndex = null;

    for (let i = 0; i < this._visibleStars.length; i += 1) {
      this._screenPos.copy(asVector3(this._visibleStars[i].positionJ2000)).project(camera);
      if (this._screenPos.z < -1 || this._screenPos.z > 1) {
        continue;
      }

      const x = (this._screenPos.x * 0.5 + 0.5) * width;
      const y = (-this._screenPos.y * 0.5 + 0.5) * height;
      const dx = x - clientX;
      const dy = y - clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= 35 && distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    this._selectedStarIndex = bestIndex;
    const star = bestIndex === null ? null : this._visibleStars[bestIndex];
    if (this._onSelect) {
      this._onSelect(star);
    }

    return star;
  }
}
