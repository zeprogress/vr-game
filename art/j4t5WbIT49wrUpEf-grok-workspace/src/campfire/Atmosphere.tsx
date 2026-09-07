import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { SKY_FRAG, SKY_VERT } from "./shaders";
import { useViewer } from "./store";

const DAY = {
  top: new THREE.Color("#6a8aaa"),
  horizon: new THREE.Color("#d2c2a4"),
  nadir: new THREE.Color("#4a5538"),
  fog: new THREE.Color("#b7c0ae"),
  hemiSky: new THREE.Color("#c5d4e6"),
  hemiGround: new THREE.Color("#5a6044"),
  sunPos: new THREE.Vector3(8, 16, 6),
  sunColor: new THREE.Color("#fff2d6"),
  hemi: 0.85,
  sun: 1.35,
  exposure: 1.08,
  fogNear: 18,
  fogFar: 48,
};

const NIGHT = {
  top: new THREE.Color("#05070f"),
  horizon: new THREE.Color("#2a1810"),
  nadir: new THREE.Color("#08060a"),
  fog: new THREE.Color("#07080c"),
  hemiSky: new THREE.Color("#1a2238"),
  hemiGround: new THREE.Color("#1c120c"),
  sunPos: new THREE.Vector3(-10, 14, -8),
  sunColor: new THREE.Color("#8896b8"),
  hemi: 0.18,
  sun: 0.12,
  exposure: 0.92,
  fogNear: 10,
  fogFar: 32,
};

function SkyDome() {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const mode = useViewer((s) => s.mode);
  const uniforms = useMemo(
    () => ({
      uTop: { value: NIGHT.top.clone() },
      uHorizon: { value: NIGHT.horizon.clone() },
      uNadir: { value: NIGHT.nadir.clone() },
    }),
    [],
  );

  useFrame((_, dt) => {
    const m = mat.current;
    if (!m) return;
    const t = Math.min(dt * 2.2, 0.08);
    const pal = mode === "night" ? NIGHT : DAY;
    m.uniforms.uTop.value.lerp(pal.top, t);
    m.uniforms.uHorizon.value.lerp(pal.horizon, t);
    m.uniforms.uNadir.value.lerp(pal.nadir, t);
  });

  return (
    <mesh>
      <sphereGeometry args={[40, 24, 16]} />
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={SKY_VERT}
        fragmentShader={SKY_FRAG}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  );
}

function Stars() {
  const mode = useViewer((s) => s.mode);
  const mat = useRef<THREE.PointsMaterial>(null);
  const positions = useMemo(() => {
    const n = 280;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const az = Math.random() * Math.PI * 2;
      const pol = Math.random() * 0.9;
      const r = 36;
      arr[i * 3] = Math.cos(az) * Math.sin(pol) * r;
      arr[i * 3 + 1] = Math.cos(pol) * r * 0.55 + 8;
      arr[i * 3 + 2] = Math.sin(az) * Math.sin(pol) * r;
    }
    return arr;
  }, []);

  useFrame((_, dt) => {
    if (!mat.current) return;
    const target = mode === "night" ? 0.9 : 0;
    mat.current.opacity += (target - mat.current.opacity) * Math.min(dt * 3, 1);
    mat.current.visible = mat.current.opacity > 0.02;
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={mat}
        color="#f4f0e4"
        size={0.12}
        sizeAttenuation
        transparent
        opacity={0.9}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}

function Lights() {
  const mode = useViewer((s) => s.mode);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useFrame((_, dt) => {
    const pal = mode === "night" ? NIGHT : DAY;
    const k = Math.min(dt * 2.4, 0.1);
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
    if (fog instanceof THREE.Fog) {
      fog.color.lerp(pal.fog, k);
      fog.near += (pal.fogNear - fog.near) * k * 6;
      fog.far += (pal.fogFar - fog.far) * k * 6;
    }
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={["#1a2238", "#1c120c", NIGHT.hemi]} />
      <directionalLight
        ref={sun}
        position={[-10, 14, -8]}
        intensity={NIGHT.sun}
        color="#8896b8"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-bias={-0.0004}
      />
    </>
  );
}

export function Atmosphere() {
  const autoRotate = useViewer((s) => s.autoRotate);
  const resetNonce = useViewer((s) => s.resetNonce);
  const controls = useRef<OrbitControlsImpl>(null);

  useEffect(() => {
    const c = controls.current;
    if (!c || resetNonce === 0) return;
    c.object.position.set(5.1, 2.45, 6.3);
    c.target.set(0, 0.55, 0);
    c.update();
  }, [resetNonce]);

  return (
    <>
      <SkyDome />
      <Stars />
      <Lights />
      <fog attach="fog" args={["#07080c", NIGHT.fogNear, NIGHT.fogFar]} />
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.06}
        autoRotate={autoRotate}
        autoRotateSpeed={0.42}
        minDistance={2.3}
        maxDistance={14}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 2 - 0.05}
        target={[0, 0.55, 0]}
        enablePan={false}
      />
    </>
  );
}
