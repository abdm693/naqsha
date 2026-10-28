/**
 * Image-based light (RoomEnvironment PMREM, no network HDRIs), the Preetham Sky synced to the sun, a soft ground
 * plane so the house never floats, and the sun light itself (the engine's `kind: "sun"` light when present,
 * otherwise a viewer-owned fallback until the design's lighting section runs).
 */
import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Quality } from "../core/store";
import { lerp, smoothstep } from "../core/units";
import type { SunState } from "../core/sun";

/**
 * Emissive fixtures and additive light pools read as "on" at dusk and subtle at noon. Mirrors the engine's
 * setTimeOfDay (same userData keys, so the two never fight); safe to call on every slider move.
 */
export function applyNight(root: THREE.Object3D, night: number) {
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (!mat || seen.has(mat)) continue;
      seen.add(mat);
      const sm = mat as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial;
      if (sm.blending === THREE.AdditiveBlending) {
        sm.userData.baseOpacity ??= sm.opacity;
        sm.opacity = (sm.userData.baseOpacity as number) * (0.12 + 0.88 * night);
      } else if (sm.emissive && sm.emissiveIntensity > 0 && sm.emissive.getHex() !== 0) {
        sm.userData.baseEmissive ??= sm.emissiveIntensity;
        sm.emissiveIntensity = (sm.userData.baseEmissive as number) * (0.35 + 0.65 * night);
      }
    }
  });
}

/**
 * Ground plane texture (no network): lighter, warmer near the plot and darker, cooler toward the horizon, with soft
 * low-frequency mottling so the big plane doesn't read as a flat desert. Mapped once across the 900 m disc.
 */
function groundTexture(): THREE.Texture {
  const N = 512;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d")!;
  const rad = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  rad.addColorStop(0, "#ffffff");
  rad.addColorStop(0.035, "#f6f5f2");
  rad.addColorStop(0.12, "#e6e5e1");
  rad.addColorStop(0.45, "#d8d8d5");
  rad.addColorStop(1, "#d0d1cf");
  g.fillStyle = rad;
  g.fillRect(0, 0, N, N);
  // mottling: a few hundred soft blotches
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 420; i++) {
    const x = rnd() * N, y = rnd() * N, r = 6 + rnd() * 34;
    const dark = rnd() < 0.55;
    const blot = g.createRadialGradient(x, y, 0, x, y, r);
    blot.addColorStop(0, dark ? "rgba(70,62,48,0.10)" : "rgba(255,250,235,0.10)");
    blot.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = blot;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Night sky: a deep blue gradient with a faint glow at the horizon and sparse stars, faded in over the day sky. */
function nightDome(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uAlpha: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w; // always at the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAlpha;
      varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main() {
        float h = clamp(vDir.y, -1.0, 1.0);
        // full night: a blue-hour sky (the concepts' night renders), so the house's lit facade reads against it, not
        // lost in black; the dusk blend (low uAlpha) keeps the deeper dusk colours it always had
        float deep = smoothstep(0.35, 1.0, uAlpha);
        vec3 zenith = mix(vec3(0.010, 0.014, 0.032), vec3(0.014, 0.026, 0.078), deep);
        vec3 horizon = mix(vec3(0.060, 0.078, 0.135), vec3(0.070, 0.098, 0.195), deep);
        vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.45));
        // the city's glow along the horizon
        col += vec3(0.075, 0.055, 0.040) * exp(-max(h, 0.0) * 14.0);
        if (h > 0.08) {
          vec3 c = floor(vDir * 420.0);
          float s = hash(c);
          if (s > 0.9965) col += vec3(0.55, 0.58, 0.66) * (s - 0.9965) / 0.0035 * smoothstep(0.08, 0.35, h);
        }
        if (h < 0.0) col = horizon * 0.6;
        gl_FragColor = vec4(col, uAlpha);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    // drawn in the opaque list right after the day sky (renderOrder), blended by hand
    transparent: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(2500, 48, 24), mat);
  m.frustumCulled = false;
  m.renderOrder = -0.5;
  m.userData = { noPick: true, viewer: "night-sky" };
  m.visible = false;
  return m;
}

const MOON_DIR = new THREE.Vector3(0.45, 0.8, -0.4).normalize();
const MOON_COLOR = new THREE.Color("#a9bcff");
const NIGHT_FOG = new THREE.Color("#0e1322");
/** Full night's haze: the blue-hour sky's horizon (dusk keeps the darker one it always had). */
const DEEP_NIGHT_FOG = new THREE.Color("#1d2740");
const NIGHT_HEMI_SKY = new THREE.Color("#25324f");
const NIGHT_HEMI_GROUND = new THREE.Color("#0a0b0e");

export class Atmosphere {
  readonly sky = new Sky();
  readonly night = nightDome();
  /** 0 = day … 1 = night (from the sun's altitude or the `night` prop), as last applied. */
  nightness = 0;
  readonly ground: THREE.Mesh;
  readonly fallbackSun = new THREE.DirectionalLight("#fff3e2", 3.0);
  /**
   * Night: a warm flood from the street onto the front of the house (the way a night photograph of a home is lit),
   * so the house, not the neighbours, holds the eye. Always in the scene (intensity 0 by day) so turning night on
   * never changes the light count and never recompiles a shader.
   */
  readonly facadeLight = new THREE.SpotLight("#ffcf9a", 0, 34, 0.7, 0.65, 1.6);
  readonly env: THREE.Texture;
  private engineSunBase = new WeakMap<THREE.DirectionalLight, number>();
  private configured = new WeakMap<THREE.DirectionalLight, string>();
  /** World-space box the shadow camera must cover (the plot + house height). */
  shadowFocus = new THREE.Box3(new THREE.Vector3(-2, 0, -4), new THREE.Vector3(14, 10, 22));
  daylight = 1;
  exposure = 1;

  constructor(private gl: THREE.WebGLRenderer, private scene: THREE.Scene) {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    this.env = pmrem.fromScene(room, 0.04).texture;
    room.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    pmrem.dispose();
    scene.environment = this.env;
    scene.environmentIntensity = 0.6;

    const u = this.sky.material.uniforms;
    u.turbidity.value = 4.2; // a little Lahore haze
    u.rayleigh.value = 1.15;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.84;
    if (u.cloudCoverage) u.cloudCoverage.value = 0.22;
    if (u.cloudDensity) u.cloudDensity.value = 0.32;
    if (u.cloudElevation) u.cloudElevation.value = 0.62;
    this.sky.scale.setScalar(6000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.sky.userData = { noPick: true, viewer: "sky" };
    scene.add(this.sky, this.night);

    const groundMat = new THREE.MeshStandardMaterial({ color: "#c4c2bb", roughness: 1, metalness: 0, map: groundTexture() });
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(900, 72), groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.06;
    this.ground.receiveShadow = true;
    this.ground.userData = { noPick: true, viewer: "ground" };
    scene.add(this.ground);
    scene.fog = new THREE.Fog("#d4d6d2", 70, 560);

    this.fallbackSun.castShadow = true;
    this.fallbackSun.userData = { viewer: "fallback-sun" };
    scene.add(this.fallbackSun, this.fallbackSun.target);
    this.facadeLight.castShadow = false;
    this.facadeLight.userData = { viewer: "facade-light" };
    scene.add(this.facadeLight, this.facadeLight.target);
  }

  /** Keep shadows crisp and stable: fit an orthographic frustum around the plot's bounding sphere. */
  configureShadow(light: THREE.DirectionalLight, quality: Quality) {
    const key = `${quality}|${this.shadowFocus.min.toArray().join()}|${this.shadowFocus.max.toArray().join()}`;
    if (this.configured.get(light) === key) return;
    this.configured.set(light, key);
    const size = quality === "high" ? 4096 : 2048;
    light.castShadow = true;
    if (light.shadow.mapSize.x !== size) {
      light.shadow.mapSize.set(size, size);
      light.shadow.map?.dispose();
      (light.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
    const sphere = this.shadowFocus.getBoundingSphere(new THREE.Sphere());
    const r = sphere.radius + 1.5;
    const cam = light.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.5;
    cam.far = r * 2 + 80;
    cam.updateProjectionMatrix();
    light.shadow.bias = -0.00025;
    light.shadow.normalBias = 0.028;
    light.shadow.radius = quality === "performance" ? 2 : 3.5;
    light.shadow.needsUpdate = true;
  }

  /**
   * Point `light` along `sun` and retint it like the engine's updateSun (engine/lights.ts), then sync the design's
   * hemisphere "sky" fill, night emissives, Sky shader, fog, IBL and exposure.
   */
  applySun(light: THREE.DirectionalLight, sun: SunState, engine: { owned: boolean; hemi?: THREE.HemisphereLight | null; root?: THREE.Object3D | null }) {
    if (engine.owned) {
      // keep the design's own target and distance; just move along the new direction
      const dist = (light.userData.sunDistance as number) ?? 70;
      light.position.copy(light.target.position).addScaledVector(sun.dir, dist);
      light.intensity = sun.intensity * ((light.userData.intensityScale as number) ?? 1);
    } else {
      const center = this.shadowFocus.getCenter(new THREE.Vector3());
      const dist = this.shadowFocus.getBoundingSphere(new THREE.Sphere()).radius + 40;
      light.position.copy(center).addScaledVector(sun.dir, dist);
      light.target.position.copy(center);
      light.intensity = sun.intensity * 1.15;
    }
    light.target.updateMatrixWorld();
    light.updateMatrixWorld();
    light.color.copy(sun.color);
    const hemi = engine.hemi;
    if (hemi) {
      hemi.color.copy(sun.hemi.sky);
      hemi.groundColor.copy(sun.hemi.ground);
      hemi.intensity = sun.hemi.intensity * ((hemi.userData.intensityScale as number) ?? 1);
    }
    if (engine.root) applyNight(engine.root, sun.night);
    this.daylight = sun.daylight;
    this.hasHemi = !!hemi;
    this.syncSky(sun.skyDir);
  }

  private hasHemi = false;

  /**
   * Align sky, fog, IBL and exposure with a sun the engine positioned itself. `trueAltitude` (radians) lets the sky's
   * disc set below the horizon even though the light is clamped a little above it.
   */
  syncSkyToLight(light: THREE.DirectionalLight, trueAltitude?: number, hasHemi = false) {
    light.target.updateMatrixWorld();
    const dir = new THREE.Vector3().subVectors(light.position, light.target.position).normalize();
    if (trueAltitude !== undefined && Number.isFinite(trueAltitude)) {
      const h = new THREE.Vector3(dir.x, 0, dir.z);
      if (h.lengthSq() > 1e-8) h.normalize();
      dir.copy(h).multiplyScalar(Math.cos(trueAltitude)).setY(Math.sin(trueAltitude));
    }
    this.daylight = smoothstep(-3, 8, (Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) * 180) / Math.PI);
    this.hasHemi = hasHemi;
    this.syncSky(dir);
  }

  private syncSky(dir: THREE.Vector3) {
    this.sky.material.uniforms.sunPosition.value.copy(dir);
    const d = this.daylight;
    const golden = 1 - smoothstep(0.08, 0.45, dir.y);
    // the design's hemisphere light already fills the shade; keep the IBL for reflections mostly
    this.scene.environmentIntensity = lerp(0.14, 0.36, d) * (this.hasHemi ? 0.6 : 1);
    // haze = the sky's own colour just above the horizon, so the ground plane melts into it
    const fog = this.scene.fog as THREE.Fog;
    const horizon = this.sampleHorizon();
    if (horizon) fog.color.copy(horizon);
    else fog.color.set("#d3d7d6").lerp(new THREE.Color("#e6c6a4"), golden * 0.85).lerp(new THREE.Color("#5c5a63"), 1 - d);
    (this.ground.material as THREE.MeshStandardMaterial).color.set("#c4c2bb").lerp(new THREE.Color("#b9aa98"), golden * 0.2);
    this.exposure = lerp(1.45, 1.0, d) * (1 + golden * 0.08);
  }

  private probe: { rt: THREE.WebGLRenderTarget; cam: THREE.PerspectiveCamera; scene: THREE.Scene; buf: Uint16Array } | null = null;

  /** Average linear colour of the sky 2° above the horizon (4 azimuths), read from a 1×1 half-float target. */
  private sampleHorizon(): THREE.Color | null {
    try {
      if (!this.probe) {
        const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
        const scene = new THREE.Scene();
        const sky = new THREE.Mesh(this.sky.geometry, this.sky.material);
        sky.scale.setScalar(100);
        sky.frustumCulled = false;
        scene.add(sky);
        this.probe = { rt, cam: new THREE.PerspectiveCamera(6, 1, 0.1, 1000), scene, buf: new Uint16Array(4) };
      }
      const { rt, cam, scene, buf } = this.probe;
      const prevTarget = this.gl.getRenderTarget();
      const prevClip = this.gl.clippingPlanes;
      this.gl.clippingPlanes = [];
      const samples: THREE.Color[] = [];
      const el = THREE.MathUtils.degToRad(3);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.2;
        cam.position.set(0, 0, 0);
        cam.lookAt(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
        cam.updateMatrixWorld();
        this.gl.setRenderTarget(rt);
        this.gl.render(scene, cam);
        this.gl.readRenderTargetPixels(rt, 0, 0, 1, 1, buf);
        samples.push(new THREE.Color(THREE.DataUtils.fromHalfFloat(buf[0]), THREE.DataUtils.fromHalfFloat(buf[1]), THREE.DataUtils.fromHalfFloat(buf[2])));
      }
      this.gl.setRenderTarget(prevTarget);
      this.gl.clippingPlanes = prevClip;
      // median by luminance: the sun-side glow would otherwise wash the whole horizon out
      samples.sort((p, q) => p.r + p.g + p.b - (q.r + q.g + q.b));
      const acc = samples[3].clone().add(samples[4]).multiplyScalar(0.5 * 0.92);
      const sum = acc.r + acc.g + acc.b;
      if (!Number.isFinite(sum) || sum < 1e-4) return null; // unreadable target → keep the analytic fallback
      return acc;
    } catch {
      return null;
    }
  }

  /**
   * Night on top of whatever the day pass set (call after applySun / syncSkyToLight, every time): the sun becomes a
   * cool moon from high behind the house, the sky goes deep blue with stars, fog and reflections darken, and every
   * fixture and glow in the house comes on. `n` blends 0 (day) → 1 (night) so dusk on the slider is continuous.
   */
  applyNightMode(n: number, light: THREE.DirectionalLight | null, hemi: THREE.HemisphereLight | null, root: THREE.Object3D | null) {
    n = Math.min(1, Math.max(0, n));
    // how far into full night (View > Night): the blue-hour sky, haze and a softer flood; dusk's blend stays as it was
    const deep = smoothstep(0.35, 1, n);
    this.nightness = n;
    {
      // aim the flood at the front of the house box (the road is at +z)
      const b = this.shadowFocus;
      const cx = (b.min.x + b.max.x) / 2, width = b.max.x - b.min.x, top = b.max.y, front = b.max.z - 1.5;
      this.facadeLight.position.set(cx, 0.6, front + 8.5);
      this.facadeLight.target.position.set(cx, top * 0.42, front - 1.5);
      this.facadeLight.angle = Math.min(1.1, Math.atan2(width * 0.62, 9));
      this.facadeLight.target.updateMatrixWorld();
      this.facadeLight.intensity = lerp(120, 105, deep) * n * n;
    }
    this.night.visible = n > 0.001;
    this.night.material.uniforms.uAlpha.value = n;
    this.sky.visible = n < 0.999;
    if (root) {
      // interior lights a touch brighter at night (they were sized to read in daylight)
      root.traverse((o) => {
        const l = o as THREE.PointLight;
        if (!l.isPointLight && !(o as THREE.SpotLight).isSpotLight) return;
        l.userData.nqBase ??= l.intensity;
        l.intensity = (l.userData.nqBase as number) * (1 + 0.45 * n);
      });
    }
    if (n <= 0.001) return;
    if (light) {
      const tgt = light.target.position;
      const dist = light.position.distanceTo(tgt) || 70;
      const dir = new THREE.Vector3().subVectors(light.position, tgt).normalize();
      // below the horizon the "sun" is the moon: swing the light to the moon's direction
      dir.lerp(MOON_DIR, n).normalize();
      light.position.copy(tgt).addScaledVector(dir, dist);
      light.updateMatrixWorld();
      const moon = 0.15 * ((light.userData.intensityScale as number) ?? 1);
      light.intensity = light.intensity + (moon - light.intensity) * n;
      light.color.lerp(MOON_COLOR, n);
    }
    if (hemi) {
      hemi.color.lerp(NIGHT_HEMI_SKY, n);
      hemi.groundColor.lerp(NIGHT_HEMI_GROUND, n);
      hemi.intensity = hemi.intensity + (0.06 * ((hemi.userData.intensityScale as number) ?? 1) - hemi.intensity) * n;
    }
    (this.scene.fog as THREE.Fog).color.lerp(NIGHT_FOG.clone().lerp(DEEP_NIGHT_FOG, deep), n);
    this.scene.environmentIntensity = lerp(this.scene.environmentIntensity, 0.015, n);
    this.exposure = lerp(this.exposure, 1.05, n);
    (this.ground.material as THREE.MeshStandardMaterial).color.lerp(new THREE.Color("#8d8f94"), n);
    if (root) applyNight(root, Math.max(n, this.daylightNight));
  }

  /** Emissive "on" level the day pass chose (so the night pass never dims fixtures at dusk). */
  daylightNight = 0;

  baseIntensity(light: THREE.DirectionalLight) {
    if (!this.engineSunBase.has(light)) this.engineSunBase.set(light, light.intensity > 0 ? light.intensity : 3);
    return this.engineSunBase.get(light)!;
  }

  setFallbackActive(on: boolean) {
    this.fallbackSun.visible = on;
    this.fallbackSun.castShadow = on;
  }

  dispose() {
    this.probe?.rt.dispose();
    this.probe = null;
    this.scene.remove(this.sky, this.night, this.ground, this.fallbackSun, this.fallbackSun.target, this.facadeLight, this.facadeLight.target);
    this.facadeLight.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.night.geometry.dispose();
    this.night.material.dispose();
    this.ground.geometry.dispose();
    (this.ground.material as THREE.MeshStandardMaterial).map?.dispose();
    (this.ground.material as THREE.Material).dispose();
    this.fallbackSun.shadow.map?.dispose();
    this.fallbackSun.dispose();
    if (this.scene.environment === this.env) this.scene.environment = null;
    this.env.dispose();
    this.scene.fog = null;
  }
}
