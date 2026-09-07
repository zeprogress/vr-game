import { i as __toESM } from "../_runtime.mjs";
import { _ as require_react, a as useFrame, c as CanvasTexture, d as IcosahedronGeometry, f as RepeatWrapping, g as require_jsx_runtime, i as Canvas, l as Color, m as Vector3, n as useTexture, o as useThree, p as SRGBColorSpace, r as Billboard, t as OrbitControls, u as Fog } from "../_libs/@react-three/drei+[...].mjs";
import { a as RotateCw, c as Flame, i as Sun, n as Volume2, o as RotateCcw, s as Moon, t as VolumeX } from "../_libs/lucide-react.mjs";
import { t as create } from "../_libs/zustand.mjs";
import { n as clsx, t as cva } from "../_libs/class-variance-authority+clsx.mjs";
import { t as twMerge } from "../_libs/tailwind-merge.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-C65sI_wc.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var FIRE_VERT = `
varying vec2 vUv;
uniform float uTime;
uniform float uAmp;

void main() {
  vUv = uv;
  vec3 p = position;
  float top = uv.y;
  float n1 = sin(p.x * 9.0 + uTime * 4.4) * cos(p.z * 7.5 - uTime * 3.1);
  float n2 = cos(p.x * 5.2 - uTime * 5.6) * sin(p.z * 6.1 + uTime * 2.7);
  p.x += (n1 + n2 * 0.55) * uAmp * top;
  p.z += (n2 - n1 * 0.4) * uAmp * top * 0.85;
  p.y += abs(n1) * 0.07 * top;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;
var FIRE_FRAG = `
varying vec2 vUv;
uniform float uTime;
uniform float uWrap;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  v += a * noise(p); p *= 2.07; a *= 0.5;
  v += a * noise(p); p *= 2.03; a *= 0.5;
  v += a * noise(p); p *= 2.11; a *= 0.5;
  v += a * noise(p);
  return v;
}

void main() {
  vec2 uv = vUv;
  float n = fbm(vec2(uv.x * 3.4, uv.y * 2.15 - uTime * 1.15));
  float n2 = fbm(vec2(uv.x * 6.2 + 17.0, uv.y * 3.1 - uTime * 1.8));
  float warp = (n - 0.5) * 0.5;

  float mask;
  if (uWrap > 0.5) {
    float around = abs(fract(uv.x * 5.0 + warp * 0.8 + uTime * 0.12) - 0.5) * 2.0;
    float tongue = 1.0 - smoothstep(0.12, 0.95, around + pow(uv.y, 0.55) * 0.85);
    mask = tongue * (1.0 - smoothstep(0.35, 1.0, uv.y));
    mask *= smoothstep(0.0, 0.05, uv.y);
    mask *= 0.55 + 0.6 * n2;
  } else {
    float x = uv.x - 0.5 + warp * uv.y;
    float width = mix(0.44, 0.045, pow(uv.y, 0.7));
    mask = 1.0 - smoothstep(width * 0.25, width, abs(x));
    mask *= 1.0 - smoothstep(0.45, 1.0, uv.y);
    mask *= smoothstep(0.0, 0.06, uv.y);
    mask *= 0.55 + 0.6 * n2;
  }

  vec3 col = mix(uColorA, uColorB, clamp(uv.y * 1.05 + (n - 0.5) * 0.2, 0.0, 1.0));
  col = mix(col, uColorC, pow(uv.y, 1.25));
  col *= 1.2 + (n2 - 0.35) * 0.75;

  gl_FragColor = vec4(col * 1.65, clamp(mask, 0.0, 1.0));
}
`;
var SMOKE_VERT = `
varying vec2 vUv;
uniform float uTime;
uniform float uSpeed;

void main() {
  vUv = uv;
  vec3 p = position;
  float t = uTime * uSpeed;
  p.x += sin(t + uv.y * 4.0) * 0.12 * uv.y;
  p.z += cos(t * 0.8 + uv.y * 3.0) * 0.1 * uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;
var SMOKE_FRAG = `
varying vec2 vUv;
uniform float uTime;
uniform float uOpacity;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  v += a * noise(p); p *= 2.1; a *= 0.5;
  v += a * noise(p); p *= 2.1; a *= 0.5;
  v += a * noise(p);
  return v;
}

void main() {
  vec2 uv = vUv;
  float n = fbm(vec2(uv.x * 2.4, uv.y * 1.6 - uTime * 0.18));
  float x = abs(uv.x - 0.5);
  float mask = (1.0 - smoothstep(0.12, 0.48, x + uv.y * 0.18));
  mask *= (1.0 - uv.y);
  mask *= smoothstep(0.0, 0.12, uv.y);
  mask *= 0.45 + 0.7 * n;
  vec3 col = mix(vec3(0.42, 0.4, 0.38), vec3(0.22, 0.22, 0.24), uv.y);
  gl_FragColor = vec4(col, mask * uOpacity);
}
`;
var SKY_VERT = `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
var SKY_FRAG = `
varying vec3 vWorld;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uNadir;
void main() {
  float h = normalize(vWorld).y;
  vec3 col = mix(uHorizon, uTop, smoothstep(-0.02, 0.62, h));
  col = mix(uNadir, col, smoothstep(-0.45, 0.08, h));
  gl_FragColor = vec4(col, 1.0);
}
`;
var useViewer = create((set) => ({
	mode: "night",
	autoRotate: true,
	muted: false,
	resetNonce: 0,
	setMode: (mode) => set({ mode }),
	toggleAutoRotate: () => set((s) => ({ autoRotate: !s.autoRotate })),
	toggleMuted: () => set((s) => ({ muted: !s.muted })),
	resetCamera: () => set((s) => ({ resetNonce: s.resetNonce + 1 }))
}));
var DAY = {
	top: new Color("#6a8aaa"),
	horizon: new Color("#d2c2a4"),
	nadir: new Color("#4a5538"),
	fog: new Color("#b7c0ae"),
	hemiSky: new Color("#c5d4e6"),
	hemiGround: new Color("#5a6044"),
	sunPos: new Vector3(8, 16, 6),
	sunColor: new Color("#fff2d6"),
	hemi: .85,
	sun: 1.35,
	exposure: 1.08,
	fogNear: 18,
	fogFar: 48
};
var NIGHT = {
	top: new Color("#05070f"),
	horizon: new Color("#2a1810"),
	nadir: new Color("#08060a"),
	fog: new Color("#07080c"),
	hemiSky: new Color("#1a2238"),
	hemiGround: new Color("#1c120c"),
	sunPos: new Vector3(-10, 14, -8),
	sunColor: new Color("#8896b8"),
	hemi: .18,
	sun: .12,
	exposure: .92,
	fogNear: 10,
	fogFar: 32
};
function SkyDome() {
	const mat = (0, import_react.useRef)(null);
	const mode = useViewer((s) => s.mode);
	const uniforms = (0, import_react.useMemo)(() => ({
		uTop: { value: NIGHT.top.clone() },
		uHorizon: { value: NIGHT.horizon.clone() },
		uNadir: { value: NIGHT.nadir.clone() }
	}), []);
	useFrame((_, dt) => {
		const m = mat.current;
		if (!m) return;
		const t = Math.min(dt * 2.2, .08);
		const pal = mode === "night" ? NIGHT : DAY;
		m.uniforms.uTop.value.lerp(pal.top, t);
		m.uniforms.uHorizon.value.lerp(pal.horizon, t);
		m.uniforms.uNadir.value.lerp(pal.nadir, t);
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("sphereGeometry", { args: [
		40,
		24,
		16
	] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("shaderMaterial", {
		ref: mat,
		uniforms,
		vertexShader: SKY_VERT,
		fragmentShader: SKY_FRAG,
		side: 1,
		depthWrite: false
	})] });
}
function Stars() {
	const mode = useViewer((s) => s.mode);
	const mat = (0, import_react.useRef)(null);
	const positions = (0, import_react.useMemo)(() => {
		const n = 280;
		const arr = new Float32Array(n * 3);
		for (let i = 0; i < n; i++) {
			const az = Math.random() * Math.PI * 2;
			const pol = Math.random() * .9;
			const r = 36;
			arr[i * 3] = Math.cos(az) * Math.sin(pol) * r;
			arr[i * 3 + 1] = Math.cos(pol) * r * .55 + 8;
			arr[i * 3 + 2] = Math.sin(az) * Math.sin(pol) * r;
		}
		return arr;
	}, []);
	useFrame((_, dt) => {
		if (!mat.current) return;
		const target = mode === "night" ? .9 : 0;
		mat.current.opacity += (target - mat.current.opacity) * Math.min(dt * 3, 1);
		mat.current.visible = mat.current.opacity > .02;
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("points", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("bufferGeometry", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("bufferAttribute", {
		attach: "attributes-position",
		args: [positions, 3]
	}) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pointsMaterial", {
		ref: mat,
		color: "#f4f0e4",
		size: .12,
		sizeAttenuation: true,
		transparent: true,
		opacity: .9,
		depthWrite: false,
		toneMapped: false
	})] });
}
function Lights() {
	const mode = useViewer((s) => s.mode);
	const hemi = (0, import_react.useRef)(null);
	const sun = (0, import_react.useRef)(null);
	const gl = useThree((s) => s.gl);
	const scene = useThree((s) => s.scene);
	useFrame((_, dt) => {
		const pal = mode === "night" ? NIGHT : DAY;
		const k = Math.min(dt * 2.4, .1);
		if (hemi.current) {
			hemi.current.intensity += (pal.hemi - hemi.current.intensity) * k * 8;
			hemi.current.color.lerp(pal.hemiSky, k);
			hemi.current.groundColor.lerp(pal.hemiGround, k);
		}
		if (sun.current) {
			sun.current.intensity += (pal.sun - sun.current.intensity) * k * 8;
			sun.current.color.lerp(pal.sunColor, k);
			sun.current.position.lerp(pal.sunPos, k);
		}
		gl.toneMappingExposure += (pal.exposure - gl.toneMappingExposure) * k * 6;
		const fog = scene.fog;
		if (fog instanceof Fog) {
			fog.color.lerp(pal.fog, k);
			fog.near += (pal.fogNear - fog.near) * k * 6;
			fog.far += (pal.fogFar - fog.far) * k * 6;
		}
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("hemisphereLight", {
		ref: hemi,
		args: [
			"#1a2238",
			"#1c120c",
			NIGHT.hemi
		]
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("directionalLight", {
		ref: sun,
		position: [
			-10,
			14,
			-8
		],
		intensity: NIGHT.sun,
		color: "#8896b8",
		castShadow: true,
		"shadow-mapSize-width": 1024,
		"shadow-mapSize-height": 1024,
		"shadow-camera-near": 1,
		"shadow-camera-far": 40,
		"shadow-camera-left": -12,
		"shadow-camera-right": 12,
		"shadow-camera-top": 12,
		"shadow-camera-bottom": -12,
		"shadow-bias": -4e-4
	})] });
}
function Atmosphere() {
	const autoRotate = useViewer((s) => s.autoRotate);
	const resetNonce = useViewer((s) => s.resetNonce);
	const controls = (0, import_react.useRef)(null);
	(0, import_react.useEffect)(() => {
		const c = controls.current;
		if (!c || resetNonce === 0) return;
		c.object.position.set(5.1, 2.45, 6.3);
		c.target.set(0, .55, 0);
		c.update();
	}, [resetNonce]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkyDome, {}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stars, {}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Lights, {}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("fog", {
			attach: "fog",
			args: [
				"#07080c",
				NIGHT.fogNear,
				NIGHT.fogFar
			]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(OrbitControls, {
			ref: controls,
			makeDefault: true,
			enableDamping: true,
			dampingFactor: .06,
			autoRotate,
			autoRotateSpeed: .42,
			minDistance: 2.3,
			maxDistance: 14,
			minPolarAngle: .2,
			maxPolarAngle: Math.PI / 2 - .05,
			target: [
				0,
				.55,
				0
			],
			enablePan: false
		})
	] });
}
/** Gameplay numbers for the HUB campfire. Shared with any future ZoneRoom wiring. */
var HUB = {
	campfire: {
		position: {
			x: 0,
			y: 0,
			z: 0
		},
		/** Outer radius of the stone ring, metres. */
		radius: 2
	},
	plaza: { 
	/** Dirt circle around the fire, metres. Viewer uses a compact slice of the 25 m plaza. */
dirtRadius: 5.6 },
	benches: [
		{
			azimuth: .45,
			distance: 3.7
		},
		{
			azimuth: 2.15,
			distance: 3.85
		},
		{
			azimuth: 3.7,
			distance: 3.62
		},
		{
			azimuth: 5.35,
			distance: 3.78
		}
	]
};
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = a + 1831565813 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
function makeRockGeometry(seed) {
	const rng = mulberry32(seed);
	const geo = new IcosahedronGeometry(1, 2);
	const pos = geo.attributes.position;
	const v = new Vector3();
	for (let i = 0; i < pos.count; i++) {
		v.fromBufferAttribute(pos, i);
		const n = .62 + rng() * .55;
		const pinch = .72 + rng() * .22;
		v.x *= n;
		v.z *= n;
		v.y *= n * pinch;
		if (v.y < -.15) v.y = -.22 - rng() * .04;
		pos.setXYZ(i, v.x, v.y, v.z);
	}
	geo.computeVertexNormals();
	geo.computeBoundingBox();
	const minY = geo.boundingBox?.min.y ?? 0;
	geo.translate(0, -minY, 0);
	return geo;
}
function makeGlowTexture() {
	const canvas = document.createElement("canvas");
	canvas.width = 256;
	canvas.height = 256;
	const g = canvas.getContext("2d");
	if (!g) return new CanvasTexture(canvas);
	const grd = g.createRadialGradient(128, 128, 8, 128, 128, 128);
	grd.addColorStop(0, "rgba(255, 244, 200, 1)");
	grd.addColorStop(.18, "rgba(255, 186, 74, 0.85)");
	grd.addColorStop(.42, "rgba(255, 92, 24, 0.4)");
	grd.addColorStop(.7, "rgba(120, 20, 0, 0.12)");
	grd.addColorStop(1, "rgba(0, 0, 0, 0)");
	g.fillStyle = grd;
	g.fillRect(0, 0, 256, 256);
	const tex = new CanvasTexture(canvas);
	tex.colorSpace = SRGBColorSpace;
	return tex;
}
var MapsContext = (0, import_react.createContext)(null);
function prep(tex, repeatX = 1, repeatY = 1, anisotropy = 8) {
	tex.colorSpace = SRGBColorSpace;
	tex.wrapS = RepeatWrapping;
	tex.wrapT = RepeatWrapping;
	tex.repeat.set(repeatX, repeatY);
	tex.anisotropy = anisotropy;
	tex.needsUpdate = true;
	return tex;
}
function CampMapsProvider({ children }) {
	const gl = useThree((s) => s.gl);
	const [bark, stone, dirt, grass, charred, endgrain, ash] = useTexture([
		"/textures/wood-bark.jpg",
		"/textures/stone.jpg",
		"/textures/dirt.jpg",
		"/textures/grass.jpg",
		"/textures/charred.jpg",
		"/textures/endgrain.jpg",
		"/textures/ash.jpg"
	]);
	const maps = (0, import_react.useMemo)(() => {
		const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
		return {
			bark: prep(bark, 1.4, 1, aniso),
			stone: prep(stone, 1, 1, aniso),
			dirt: prep(dirt.clone(), 4, 4, aniso),
			grass: prep(grass.clone(), 14, 14, aniso),
			charred: prep(charred, 1.2, 1, aniso),
			endgrain: prep(endgrain, 1, 1, aniso),
			ash: prep(ash.clone(), 2, 2, aniso)
		};
	}, [
		ash,
		bark,
		charred,
		dirt,
		endgrain,
		gl,
		grass,
		stone
	]);
	(0, import_react.useLayoutEffect)(() => {
		return () => {
			maps.dirt.dispose();
			maps.grass.dispose();
			maps.ash.dispose();
		};
	}, [maps]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MapsContext.Provider, {
		value: maps,
		children
	});
}
function useCampMaps() {
	const maps = (0, import_react.useContext)(MapsContext);
	if (!maps) throw new Error("useCampMaps must be used inside CampMapsProvider");
	return maps;
}
var LOGS = [
	{
		az: .12,
		len: 1.62,
		r: .11,
		tilt: .2,
		y: .15,
		dist: .7,
		charred: true
	},
	{
		az: .92,
		len: 1.36,
		r: .09,
		tilt: .14,
		y: .11,
		dist: .62,
		charred: false
	},
	{
		az: 1.78,
		len: 1.74,
		r: .125,
		tilt: .26,
		y: .19,
		dist: .78,
		charred: true
	},
	{
		az: 2.52,
		len: 1.28,
		r: .08,
		tilt: .11,
		y: .1,
		dist: .56,
		charred: false
	},
	{
		az: 3.3,
		len: 1.56,
		r: .115,
		tilt: .18,
		y: .16,
		dist: .68,
		charred: true
	},
	{
		az: 4.18,
		len: 1.42,
		r: .1,
		tilt: .34,
		y: .3,
		dist: .6,
		charred: false
	},
	{
		az: 5.02,
		len: 1.68,
		r: .12,
		tilt: .16,
		y: .14,
		dist: .74,
		charred: true
	},
	{
		az: 5.68,
		len: 1.22,
		r: .085,
		tilt: .22,
		y: .21,
		dist: .52,
		charred: false
	}
];
var KINDLING = [
	{
		az: .4,
		len: .55,
		r: .028,
		tilt: .55,
		y: .22,
		dist: .18
	},
	{
		az: 1.6,
		len: .48,
		r: .022,
		tilt: -.4,
		y: .2,
		dist: .14
	},
	{
		az: 2.9,
		len: .62,
		r: .03,
		tilt: .35,
		y: .18,
		dist: .2
	},
	{
		az: 4.1,
		len: .44,
		r: .02,
		tilt: -.5,
		y: .24,
		dist: .12
	},
	{
		az: 5.3,
		len: .58,
		r: .026,
		tilt: .28,
		y: .16,
		dist: .16
	}
];
var STONES = Array.from({ length: 11 }, (_, i) => {
	return {
		az: i / 11 * Math.PI * 2 + (i % 3 - 1) * .06,
		dist: 1.52 + i % 4 * .07 - .04,
		scale: [
			.36 + i % 3 * .07,
			.22 + i % 2 * .06,
			.3 + i % 4 * .05
		],
		rot: [
			.15 * (i + 1),
			.8 * i,
			.11 * i
		],
		seed: 140 + i * 19,
		tint: .88 + i % 5 * .035
	};
});
var COALS = Array.from({ length: 14 }, (_, i) => {
	return {
		az: i / 14 * Math.PI * 2 + .2,
		dist: .08 + i % 5 * .07,
		y: .05 + i % 3 * .02,
		s: .05 + i % 4 * .018,
		phase: i * .73
	};
});
function FireMaterial({ wrap }) {
	const ref = (0, import_react.useRef)(null);
	const uniforms = (0, import_react.useMemo)(() => ({
		uTime: { value: 0 },
		uAmp: { value: wrap ? .16 : .22 },
		uWrap: { value: wrap ? 1 : 0 },
		uColorA: { value: new Color("#fff6c8") },
		uColorB: { value: new Color("#ff6a18") },
		uColorC: { value: new Color("#6a0d00") }
	}), [wrap]);
	useFrame((_, dt) => {
		if (ref.current) ref.current.uniforms.uTime.value += Math.min(dt, .1);
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("shaderMaterial", {
		ref,
		uniforms,
		vertexShader: FIRE_VERT,
		fragmentShader: FIRE_FRAG,
		transparent: true,
		blending: 2,
		depthWrite: false,
		side: 2,
		toneMapped: false
	});
}
function Flames() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("group", {
		position: [
			0,
			.08,
			0
		],
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
				position: [
					0,
					.72,
					0
				],
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("coneGeometry", { args: [
					.32,
					1.55,
					12,
					18,
					true
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FireMaterial, { wrap: true })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
				position: [
					.06,
					.58,
					.05
				],
				rotation: [
					.08,
					.7,
					.05
				],
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("coneGeometry", { args: [
					.18,
					1.15,
					8,
					14,
					true
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FireMaterial, { wrap: true })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
				position: [
					-.05,
					.52,
					-.04
				],
				rotation: [
					-.06,
					-.5,
					0
				],
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("coneGeometry", { args: [
					.14,
					.95,
					8,
					12,
					true
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FireMaterial, { wrap: true })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
				position: [
					0,
					.82,
					0
				],
				rotation: [
					0,
					.15,
					0
				],
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("planeGeometry", { args: [1.05, 1.9] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FireMaterial, { wrap: false })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
				position: [
					0,
					.76,
					0
				],
				rotation: [
					0,
					1.05,
					0
				],
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("planeGeometry", { args: [.9, 1.7] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FireMaterial, { wrap: false })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
				position: [
					0,
					.7,
					0
				],
				rotation: [
					0,
					2.1,
					0
				],
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("planeGeometry", { args: [.78, 1.5] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FireMaterial, { wrap: false })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
				position: [
					0,
					.32,
					0
				],
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("sphereGeometry", { args: [
					.16,
					10,
					8
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshBasicMaterial", {
					color: "#ffe7a0",
					transparent: true,
					opacity: .35,
					blending: 2,
					depthWrite: false,
					toneMapped: false
				})]
			})
		]
	});
}
function Smoke() {
	const mats = (0, import_react.useRef)([]);
	useFrame((_, dt) => {
		const d = Math.min(dt, .1);
		for (const m of mats.current) if (m) m.uniforms.uTime.value += d;
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("group", {
		position: [
			0,
			.9,
			0
		],
		children: [
			0,
			1,
			2,
			3
		].map((i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
			position: [
				Math.sin(i * 1.3) * .12,
				.4 + i * .22,
				Math.cos(i * 1.1) * .1
			],
			rotation: [
				0,
				i * .7,
				0
			],
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("planeGeometry", { args: [.9 + i * .18, 1.3 + i * .2] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("shaderMaterial", {
				ref: (el) => {
					mats.current[i] = el;
				},
				uniforms: {
					uTime: { value: i * 1.4 },
					uSpeed: { value: .45 + i * .08 },
					uOpacity: { value: .11 - i * .015 }
				},
				vertexShader: SMOKE_VERT,
				fragmentShader: SMOKE_FRAG,
				transparent: true,
				depthWrite: false,
				side: 2
			})]
		}, i))
	});
}
function Sparks() {
	const ref = (0, import_react.useRef)(null);
	const data = (0, import_react.useMemo)(() => {
		const count = 52;
		return {
			count,
			positions: /* @__PURE__ */ new Float32Array(156),
			sparks: Array.from({ length: count }, () => ({
				x: (Math.random() - .5) * .35,
				y: .2 + Math.random() * .4,
				z: (Math.random() - .5) * .35,
				vx: (Math.random() - .5) * .15,
				vy: .55 + Math.random() * .7,
				vz: (Math.random() - .5) * .15,
				life: Math.random(),
				max: .7 + Math.random() * .9
			}))
		};
	}, []);
	useFrame((_, dt) => {
		const d = Math.min(dt, .1);
		const { sparks, positions } = data;
		for (let i = 0; i < sparks.length; i++) {
			const s = sparks[i];
			s.life += d;
			if (s.life >= s.max) {
				s.life = 0;
				s.x = (Math.random() - .5) * .32;
				s.y = .18 + Math.random() * .2;
				s.z = (Math.random() - .5) * .32;
				s.vx = (Math.random() - .5) * .18;
				s.vy = .5 + Math.random() * .85;
				s.vz = (Math.random() - .5) * .18;
				s.max = .65 + Math.random() * 1;
			}
			s.x += s.vx * d;
			s.y += s.vy * d;
			s.z += s.vz * d;
			s.vy += .12 * d;
			positions[i * 3] = s.x;
			positions[i * 3 + 1] = s.y;
			positions[i * 3 + 2] = s.z;
		}
		const attr = ref.current?.geometry.getAttribute("position");
		if (attr) attr.needsUpdate = true;
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("points", {
		ref,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("bufferGeometry", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("bufferAttribute", {
			attach: "attributes-position",
			args: [data.positions, 3]
		}) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pointsMaterial", {
			color: "#ffc46a",
			size: .045,
			sizeAttenuation: true,
			transparent: true,
			opacity: .9,
			blending: 2,
			depthWrite: false,
			toneMapped: false
		})]
	});
}
function Glow() {
	const tex = (0, import_react.useMemo)(() => makeGlowTexture(), []);
	const inner = (0, import_react.useRef)(null);
	const outer = (0, import_react.useRef)(null);
	(0, import_react.useEffect)(() => () => tex.dispose(), [tex]);
	useFrame(({ clock }) => {
		const t = clock.elapsedTime;
		const pulse = 1 + Math.sin(t * 3.2) * .07 + Math.sin(t * 7.1) * .04;
		if (inner.current) inner.current.scale.setScalar(.82 * pulse);
		if (outer.current) outer.current.scale.setScalar(1.55 * pulse);
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Billboard, {
		position: [
			0,
			.55,
			0
		],
		follow: true,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
			ref: inner,
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("planeGeometry", { args: [1.6, 1.6] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshBasicMaterial", {
				map: tex,
				transparent: true,
				opacity: .55,
				blending: 2,
				depthWrite: false,
				toneMapped: false,
				color: "#ff9a42"
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
			ref: outer,
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("planeGeometry", { args: [1.6, 1.6] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshBasicMaterial", {
				map: tex,
				transparent: true,
				opacity: .22,
				blending: 2,
				depthWrite: false,
				toneMapped: false,
				color: "#ff6a22"
			})]
		})]
	});
}
function Coals() {
	const maps = useCampMaps();
	const refs = (0, import_react.useRef)([]);
	useFrame(({ clock }) => {
		const t = clock.elapsedTime;
		for (let i = 0; i < refs.current.length; i++) {
			const m = refs.current[i];
			if (!m) continue;
			m.emissiveIntensity = .55 + Math.sin(t * (2.4 + i % 5 * .35) + i) * .35;
		}
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("group", { children: COALS.map((c, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
		position: [
			Math.cos(c.az) * c.dist,
			c.y,
			Math.sin(c.az) * c.dist
		],
		rotation: [
			c.phase,
			c.az,
			c.phase * .4
		],
		castShadow: true,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dodecahedronGeometry", { args: [c.s, 0] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
			ref: (el) => {
				refs.current[i] = el;
			},
			map: maps.charred,
			color: "#2a1a12",
			emissive: "#ff4a12",
			emissiveIntensity: .7,
			roughness: .7,
			metalness: .05
		})]
	}, i)) });
}
function StoneRing() {
	const maps = useCampMaps();
	const geos = (0, import_react.useMemo)(() => STONES.map((s) => makeRockGeometry(s.seed)), []);
	(0, import_react.useEffect)(() => () => geos.forEach((g) => g.dispose()), [geos]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("group", { children: STONES.map((s, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("mesh", {
		geometry: geos[i],
		position: [
			Math.cos(s.az) * s.dist,
			0,
			Math.sin(s.az) * s.dist
		],
		rotation: s.rot,
		scale: s.scale,
		castShadow: true,
		receiveShadow: true,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
			map: maps.stone,
			color: new Color().setScalar(s.tint),
			roughness: .92,
			metalness: .04,
			bumpMap: maps.stone,
			bumpScale: .045
		})
	}, i)) });
}
function Logs() {
	const maps = useCampMaps();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("group", { children: [LOGS.map((log, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("group", {
		position: [
			Math.cos(log.az) * log.dist,
			log.y,
			Math.sin(log.az) * log.dist
		],
		rotation: [
			0,
			-log.az,
			log.tilt
		],
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
			rotation: [
				0,
				0,
				Math.PI / 2
			],
			castShadow: true,
			receiveShadow: true,
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("cylinderGeometry", { args: [
					log.r * .88,
					log.r,
					log.len,
					10,
					1
				] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
					attach: "material-0",
					map: log.charred ? maps.charred : maps.bark,
					roughness: log.charred ? .7 : .84,
					metalness: 0,
					emissive: log.charred ? "#ff3a0c" : "#000000",
					emissiveIntensity: log.charred ? .18 : 0
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
					attach: "material-1",
					map: maps.endgrain,
					roughness: .72
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
					attach: "material-2",
					map: maps.endgrain,
					roughness: .72
				})
			]
		})
	}, i)), KINDLING.map((k, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("group", {
		position: [
			Math.cos(k.az) * k.dist,
			k.y,
			Math.sin(k.az) * k.dist
		],
		rotation: [
			.4,
			-k.az,
			k.tilt
		],
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
			rotation: [
				0,
				0,
				Math.PI / 2
			],
			castShadow: true,
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("cylinderGeometry", { args: [
				k.r * .8,
				k.r,
				k.len,
				6,
				1
			] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
				map: maps.bark,
				roughness: .86
			})]
		})
	}, `k-${i}`))] });
}
function AshBed() {
	const maps = useCampMaps();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
		rotation: [
			-Math.PI / 2,
			0,
			0
		],
		position: [
			0,
			.025,
			0
		],
		receiveShadow: true,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circleGeometry", { args: [.85, 28] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
			map: maps.ash,
			roughness: 1,
			metalness: 0,
			color: "#c8c2b8"
		})]
	});
}
function FireLight() {
	const ref = (0, import_react.useRef)(null);
	const mode = useViewer((s) => s.mode);
	useFrame(({ clock }) => {
		const light = ref.current;
		if (!light) return;
		const t = clock.elapsedTime;
		const flicker = 1 + Math.sin(t * 8.2) * .07 + Math.sin(t * 13.6) * .045 + Math.sin(t * 3.1) * .03;
		light.intensity = (mode === "night" ? 16 : 5) * flicker;
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pointLight", {
		ref,
		position: [
			0,
			.7,
			0
		],
		color: "#ff7a32",
		intensity: 16,
		distance: 16,
		decay: 2
	});
}
function HubCampfire() {
	const { x, y, z } = HUB.campfire.position;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("group", {
		position: [
			x,
			y,
			z
		],
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AshBed, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StoneRing, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Logs, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Coals, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Flames, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Smoke, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Sparks, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Glow, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FireLight, {})
		]
	});
}
function Bench({ azimuth, distance }) {
	const maps = useCampMaps();
	const x = Math.cos(azimuth) * distance;
	const z = Math.sin(azimuth) * distance;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("group", {
		position: [
			x,
			0,
			z
		],
		rotation: [
			0,
			-azimuth + Math.PI / 2,
			0
		],
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
				position: [
					0,
					.2,
					0
				],
				rotation: [
					0,
					0,
					Math.PI / 2
				],
				castShadow: true,
				receiveShadow: true,
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("cylinderGeometry", { args: [
						.09,
						.1,
						1.15,
						8
					] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
						attach: "material-0",
						map: maps.bark,
						roughness: .88
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
						attach: "material-1",
						map: maps.endgrain,
						roughness: .72
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
						attach: "material-2",
						map: maps.endgrain,
						roughness: .72
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
				position: [
					-.38,
					.07,
					0
				],
				castShadow: true,
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("boxGeometry", { args: [
					.14,
					.14,
					.16
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
					map: maps.bark,
					roughness: .9
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
				position: [
					.38,
					.07,
					0
				],
				castShadow: true,
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("boxGeometry", { args: [
					.14,
					.14,
					.16
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
					map: maps.bark,
					roughness: .9
				})]
			})
		]
	});
}
function Pine({ position, scale = 1 }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("group", {
		position,
		scale,
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
				position: [
					0,
					.7,
					0
				],
				castShadow: true,
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("cylinderGeometry", { args: [
					.12,
					.16,
					1.4,
					6
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
					color: "#4a321c",
					roughness: .9
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
				position: [
					0,
					1.7,
					0
				],
				castShadow: true,
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("coneGeometry", { args: [
					1.15,
					1.8,
					7
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
					color: "#2c3d22",
					roughness: .88
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
				position: [
					0,
					2.55,
					0
				],
				castShadow: true,
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("coneGeometry", { args: [
					.85,
					1.5,
					7
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
					color: "#334826",
					roughness: .88
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
				position: [
					0,
					3.25,
					0
				],
				castShadow: true,
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("coneGeometry", { args: [
					.52,
					1.2,
					7
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
					color: "#3b5229",
					roughness: .88
				})]
			})
		]
	});
}
function Lantern({ azimuth, distance }) {
	const maps = useCampMaps();
	const x = Math.cos(azimuth) * distance;
	const z = Math.sin(azimuth) * distance;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("group", {
		position: [
			x,
			0,
			z
		],
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
				position: [
					0,
					.7,
					0
				],
				castShadow: true,
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("cylinderGeometry", { args: [
					.06,
					.08,
					1.4,
					6
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
					map: maps.bark,
					roughness: .86
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
				position: [
					0,
					1.48,
					0
				],
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("boxGeometry", { args: [
					.22,
					.28,
					.22
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
					color: "#f0c070",
					emissive: "#ff9a3a",
					emissiveIntensity: .85,
					roughness: .4
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
				position: [
					0,
					1.66,
					0
				],
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("boxGeometry", { args: [
					.26,
					.05,
					.26
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
					color: "#3a2a1c",
					roughness: .8
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("pointLight", {
				position: [
					0,
					1.48,
					0
				],
				color: "#ffb060",
				intensity: 4,
				distance: 6,
				decay: 2
			})
		]
	});
}
function WoodPile() {
	const maps = useCampMaps();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("group", {
		position: [
			2.55,
			0,
			-1.35
		],
		rotation: [
			0,
			.6,
			0
		],
		children: [
			{
				y: .08,
				z: 0,
				rot: .08
			},
			{
				y: .08,
				z: .16,
				rot: -.04
			},
			{
				y: .08,
				z: -.16,
				rot: .12
			},
			{
				y: .24,
				z: .08,
				rot: .2
			},
			{
				y: .24,
				z: -.07,
				rot: -.15
			},
			{
				y: .4,
				z: .01,
				rot: .05
			}
		].map((l, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
			position: [
				0,
				l.y,
				l.z
			],
			rotation: [
				0,
				l.rot,
				Math.PI / 2
			],
			castShadow: true,
			receiveShadow: true,
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("cylinderGeometry", { args: [
					.07,
					.08,
					1.05,
					8
				] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
					attach: "material-0",
					map: maps.bark,
					roughness: .86
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
					attach: "material-1",
					map: maps.endgrain,
					roughness: .7
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
					attach: "material-2",
					map: maps.endgrain,
					roughness: .7
				})
			]
		}, i))
	});
}
function ScatterRocks() {
	const maps = useCampMaps();
	const rocks = (0, import_react.useMemo)(() => [
		{
			pos: [
				2.1,
				0,
				1.8
			],
			scale: .22,
			seed: 9
		},
		{
			pos: [
				-2.4,
				0,
				1.1
			],
			scale: .18,
			seed: 21
		},
		{
			pos: [
				-1.8,
				0,
				-2.2
			],
			scale: .26,
			seed: 33
		},
		{
			pos: [
				3.2,
				0,
				.4
			],
			scale: .16,
			seed: 44
		}
	], []);
	const geos = (0, import_react.useMemo)(() => rocks.map((r) => makeRockGeometry(r.seed)), [rocks]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("group", { children: rocks.map((r, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("mesh", {
		geometry: geos[i],
		position: r.pos,
		scale: r.scale,
		castShadow: true,
		receiveShadow: true,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
			map: maps.stone,
			roughness: .94
		})
	}, i)) });
}
function Plaza() {
	const maps = useCampMaps();
	const dirtR = HUB.plaza.dirtRadius;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("group", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
			rotation: [
				-Math.PI / 2,
				0,
				0
			],
			position: [
				0,
				-.02,
				0
			],
			receiveShadow: true,
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("planeGeometry", { args: [42, 42] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
				map: maps.grass,
				roughness: .95,
				color: "#7a8a5a"
			})]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
			rotation: [
				-Math.PI / 2,
				0,
				0
			],
			position: [
				0,
				.002,
				0
			],
			receiveShadow: true,
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circleGeometry", { args: [dirtR, 48] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
				map: maps.dirt,
				roughness: .98,
				color: "#8a6a48"
			})]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
			rotation: [
				-Math.PI / 2,
				0,
				0
			],
			position: [
				0,
				.01,
				0
			],
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circleGeometry", { args: [2.35, 32] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshBasicMaterial", {
				color: "#1a120e",
				transparent: true,
				opacity: .38
			})]
		}),
		HUB.benches.map((b) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Bench, {
			azimuth: b.azimuth,
			distance: b.distance
		}, b.azimuth)),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Lantern, {
			azimuth: 1.05,
			distance: 4.6
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Lantern, {
			azimuth: 4.2,
			distance: 4.85
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(WoodPile, {}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScatterRocks, {}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pine, {
			position: [
				8.5,
				0,
				-6.2
			],
			scale: 1.15
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pine, {
			position: [
				11.2,
				0,
				-2.4
			],
			scale: .95
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pine, {
			position: [
				9.8,
				0,
				5.5
			],
			scale: 1.25
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pine, {
			position: [
				-9.4,
				0,
				4.8
			],
			scale: 1.1
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pine, {
			position: [
				-11.5,
				0,
				-3.2
			],
			scale: 1.35
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pine, {
			position: [
				-7.2,
				0,
				-8.4
			],
			scale: .9
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pine, {
			position: [
				5.4,
				0,
				-10.5
			],
			scale: 1.05
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pine, {
			position: [
				-4.8,
				0,
				10.2
			],
			scale: 1.2
		})
	] });
}
function CampCanvas() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Canvas, {
		shadows: true,
		dpr: [1, 1.6],
		camera: {
			position: [
				5.1,
				2.45,
				6.3
			],
			fov: 38,
			near: .1,
			far: 90
		},
		gl: {
			antialias: true,
			powerPreference: "high-performance",
			toneMapping: 4,
			toneMappingExposure: .92
		},
		onCreated: ({ gl }) => {
			gl.setClearColor("#07080c");
		},
		style: { touchAction: "none" },
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react.Suspense, {
			fallback: null,
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CampMapsProvider, { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Atmosphere, {}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Plaza, {}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(HubCampfire, {})
			] })
		})
	});
}
function makeNoiseBuffer(ctx, seconds = 2) {
	const length = Math.floor(ctx.sampleRate * seconds);
	const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
	const data = buffer.getChannelData(0);
	let last = 0;
	for (let i = 0; i < length; i++) {
		const white = Math.random() * 2 - 1;
		last = (last + .02 * white) / 1.02;
		data[i] = last * 3.2;
	}
	return buffer;
}
function createCampfireAudio() {
	const ctx = new AudioContext();
	const master = ctx.createGain();
	master.gain.value = 0;
	master.connect(ctx.destination);
	const noise = ctx.createBufferSource();
	noise.buffer = makeNoiseBuffer(ctx, 3);
	noise.loop = true;
	const filter = ctx.createBiquadFilter();
	filter.type = "bandpass";
	filter.frequency.value = 720;
	filter.Q.value = .7;
	const rumble = ctx.createBiquadFilter();
	rumble.type = "lowpass";
	rumble.frequency.value = 180;
	const crackleGain = ctx.createGain();
	crackleGain.gain.value = .9;
	const rumbleGain = ctx.createGain();
	rumbleGain.gain.value = .45;
	noise.connect(filter);
	noise.connect(rumble);
	filter.connect(crackleGain).connect(master);
	rumble.connect(rumbleGain).connect(master);
	noise.start();
	const lfo = ctx.createOscillator();
	lfo.type = "sine";
	lfo.frequency.value = .35;
	const lfoGain = ctx.createGain();
	lfoGain.gain.value = 90;
	lfo.connect(lfoGain).connect(filter.frequency);
	lfo.start();
	let popTimer = 0;
	let stopped = false;
	const pops = [];
	const pop = () => {
		if (stopped) return;
		const src = ctx.createBufferSource();
		src.buffer = makeNoiseBuffer(ctx, .08);
		const g = ctx.createGain();
		const now = ctx.currentTime;
		g.gain.setValueAtTime(1e-4, now);
		g.gain.exponentialRampToValueAtTime(.35 + Math.random() * .25, now + .008);
		g.gain.exponentialRampToValueAtTime(1e-4, now + .07 + Math.random() * .05);
		const bp = ctx.createBiquadFilter();
		bp.type = "bandpass";
		bp.frequency.value = 900 + Math.random() * 1400;
		bp.Q.value = 1.4;
		src.connect(bp).connect(g).connect(master);
		src.start();
		src.stop(now + .2);
		pops.push(src);
		src.onended = () => {
			const i = pops.indexOf(src);
			if (i >= 0) pops.splice(i, 1);
		};
	};
	const tick = () => {
		if (stopped) return;
		popTimer += 16;
		if (popTimer > 220 + Math.random() * 520) {
			pop();
			popTimer = 0;
		}
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	let muted = false;
	const applyGain = () => {
		const target = muted ? 0 : .055;
		master.gain.cancelScheduledValues(ctx.currentTime);
		master.gain.linearRampToValueAtTime(target, ctx.currentTime + .18);
	};
	return {
		resume: () => {
			ctx.resume();
			applyGain();
		},
		setMuted: (next) => {
			muted = next;
			applyGain();
		},
		dispose: () => {
			stopped = true;
			ctx.close();
		}
	};
}
function cn(...inputs) {
	return twMerge(clsx(inputs));
}
var buttonVariants = cva("inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition-[background-color,color,opacity,transform] duration-[var(--motion-quick)] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]", {
	variants: {
		variant: {
			solid: "bg-fg text-bg hover:bg-fg/90",
			ghost: "border border-border bg-surface/80 text-fg hover:bg-surface",
			accent: "bg-accent text-accent-fg hover:bg-accent/90"
		},
		pressed: {
			true: "",
			false: ""
		}
	},
	defaultVariants: {
		variant: "ghost",
		pressed: false
	}
});
function Button({ className, variant, pressed, type = "button", ...props }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
		type,
		className: cn(buttonVariants({
			variant,
			pressed
		}), className),
		...props
	});
}
function ViewerChrome() {
	const mode = useViewer((s) => s.mode);
	const autoRotate = useViewer((s) => s.autoRotate);
	const muted = useViewer((s) => s.muted);
	const setMode = useViewer((s) => s.setMode);
	const toggleAutoRotate = useViewer((s) => s.toggleAutoRotate);
	const toggleMuted = useViewer((s) => s.toggleMuted);
	const resetCamera = useViewer((s) => s.resetCamera);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-4 sm:p-6",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
			className: "flex items-start justify-between gap-4",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "max-w-[18rem]",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "font-sans text-xs font-medium tracking-[0.18em] text-muted uppercase",
						children: "Боевой лагерь"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
						className: "font-display text-4xl leading-none text-fg sm:text-5xl",
						children: "Костёр"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 max-w-[16rem] text-sm leading-snug text-muted",
						children: "Центр площади. Радиус 2 м. Камни, поленья и живой огонь."
					})
				]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "pointer-events-auto hidden items-center gap-2 rounded-lg border border-border bg-surface/80 px-3 py-2 text-xs text-muted sm:flex",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Flame, {
					className: "size-3.5 text-accent",
					strokeWidth: 1.75
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "HUB · (0, 0, 0)" })]
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "hidden text-xs text-muted sm:block",
				children: "Тяни, чтобы осмотреть · колесо — масштаб"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "pointer-events-auto flex flex-wrap gap-2",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
						variant: mode === "day" ? "solid" : "ghost",
						pressed: mode === "day",
						onClick: () => setMode("day"),
						"aria-pressed": mode === "day",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Sun, {
							className: "size-4",
							strokeWidth: 1.75
						}), "День"]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
						variant: mode === "night" ? "solid" : "ghost",
						pressed: mode === "night",
						onClick: () => setMode("night"),
						"aria-pressed": mode === "night",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Moon, {
							className: "size-4",
							strokeWidth: 1.75
						}), "Ночь"]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
						pressed: autoRotate,
						variant: autoRotate ? "solid" : "ghost",
						onClick: toggleAutoRotate,
						"aria-pressed": autoRotate,
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(RotateCw, {
							className: "size-4",
							strokeWidth: 1.75
						}), "Вращение"]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
						variant: muted ? "ghost" : "solid",
						pressed: !muted,
						onClick: toggleMuted,
						"aria-pressed": !muted,
						"aria-label": muted ? "Включить звук" : "Выключить звук",
						children: [muted ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(VolumeX, {
							className: "size-4",
							strokeWidth: 1.75
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Volume2, {
							className: "size-4",
							strokeWidth: 1.75
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "sm:inline",
							children: "Звук"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
						variant: "ghost",
						onClick: resetCamera,
						"aria-label": "Сбросить камеру",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(RotateCcw, {
							className: "size-4",
							strokeWidth: 1.75
						}), "Сброс"]
					})
				]
			})]
		})]
	});
}
function Home() {
	(0, import_react.useEffect)(() => {
		let audio = null;
		const start = () => {
			if (!audio) audio = createCampfireAudio();
			audio.resume();
			audio.setMuted(useViewer.getState().muted);
		};
		const unsub = useViewer.subscribe((state) => {
			audio?.setMuted(state.muted);
		});
		window.addEventListener("pointerdown", start, { once: true });
		return () => {
			window.removeEventListener("pointerdown", start);
			unsub();
			audio?.dispose();
		};
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "relative h-dvh w-full overflow-hidden bg-bg text-fg",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CampCanvas, {}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ViewerChrome, {})]
	});
}
//#endregion
export { Home as component };
