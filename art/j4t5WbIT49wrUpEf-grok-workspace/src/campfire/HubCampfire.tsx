import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import * as THREE from "three";
import { HUB } from "@/shared/hub";
import { makeGlowTexture, makeRockGeometry } from "./geometry";
import { useCampMaps } from "./maps";
import { FIRE_FRAG, FIRE_VERT, SMOKE_FRAG, SMOKE_VERT } from "./shaders";
import { useViewer } from "./store";

const LOGS = [
  { az: 0.12, len: 1.62, r: 0.11, tilt: 0.2, y: 0.15, dist: 0.7, charred: true },
  { az: 0.92, len: 1.36, r: 0.09, tilt: 0.14, y: 0.11, dist: 0.62, charred: false },
  { az: 1.78, len: 1.74, r: 0.125, tilt: 0.26, y: 0.19, dist: 0.78, charred: true },
  { az: 2.52, len: 1.28, r: 0.08, tilt: 0.11, y: 0.1, dist: 0.56, charred: false },
  { az: 3.3, len: 1.56, r: 0.115, tilt: 0.18, y: 0.16, dist: 0.68, charred: true },
  { az: 4.18, len: 1.42, r: 0.1, tilt: 0.34, y: 0.3, dist: 0.6, charred: false },
  { az: 5.02, len: 1.68, r: 0.12, tilt: 0.16, y: 0.14, dist: 0.74, charred: true },
  { az: 5.68, len: 1.22, r: 0.085, tilt: 0.22, y: 0.21, dist: 0.52, charred: false },
];

const KINDLING = [
  { az: 0.4, len: 0.55, r: 0.028, tilt: 0.55, y: 0.22, dist: 0.18 },
  { az: 1.6, len: 0.48, r: 0.022, tilt: -0.4, y: 0.2, dist: 0.14 },
  { az: 2.9, len: 0.62, r: 0.03, tilt: 0.35, y: 0.18, dist: 0.2 },
  { az: 4.1, len: 0.44, r: 0.02, tilt: -0.5, y: 0.24, dist: 0.12 },
  { az: 5.3, len: 0.58, r: 0.026, tilt: 0.28, y: 0.16, dist: 0.16 },
];

const STONES = Array.from({ length: 11 }, (_, i) => {
  const az = (i / 11) * Math.PI * 2 + ((i % 3) - 1) * 0.06;
  return {
    az,
    dist: 1.52 + (i % 4) * 0.07 - 0.04,
    scale: [
      0.36 + (i % 3) * 0.07,
      0.22 + (i % 2) * 0.06,
      0.3 + (i % 4) * 0.05,
    ] as [number, number, number],
    rot: [0.15 * (i + 1), 0.8 * i, 0.11 * i] as [number, number, number],
    seed: 140 + i * 19,
    tint: 0.88 + (i % 5) * 0.035,
  };
});

const COALS = Array.from({ length: 14 }, (_, i) => {
  const az = (i / 14) * Math.PI * 2 + 0.2;
  const dist = 0.08 + (i % 5) * 0.07;
  return {
    az,
    dist,
    y: 0.05 + (i % 3) * 0.02,
    s: 0.05 + (i % 4) * 0.018,
    phase: i * 0.73,
  };
});

function FireMaterial({ wrap }: { wrap: boolean }) {
  const ref = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmp: { value: wrap ? 0.16 : 0.22 },
      uWrap: { value: wrap ? 1 : 0 },
      uColorA: { value: new THREE.Color("#fff6c8") },
      uColorB: { value: new THREE.Color("#ff6a18") },
      uColorC: { value: new THREE.Color("#6a0d00") },
    }),
    [wrap],
  );

  useFrame((_, dt) => {
    if (ref.current) ref.current.uniforms.uTime.value += Math.min(dt, 0.1);
  });

  return (
    <shaderMaterial
      ref={ref}
      uniforms={uniforms}
      vertexShader={FIRE_VERT}
      fragmentShader={FIRE_FRAG}
      transparent
      blending={THREE.AdditiveBlending}
      depthWrite={false}
      side={THREE.DoubleSide}
      toneMapped={false}
    />
  );
}

function Flames() {
  return (
    <group position={[0, 0.08, 0]}>
      <mesh position={[0, 0.72, 0]}>
        <coneGeometry args={[0.32, 1.55, 12, 18, true]} />
        <FireMaterial wrap />
      </mesh>
      <mesh position={[0.06, 0.58, 0.05]} rotation={[0.08, 0.7, 0.05]}>
        <coneGeometry args={[0.18, 1.15, 8, 14, true]} />
        <FireMaterial wrap />
      </mesh>
      <mesh position={[-0.05, 0.52, -0.04]} rotation={[-0.06, -0.5, 0]}>
        <coneGeometry args={[0.14, 0.95, 8, 12, true]} />
        <FireMaterial wrap />
      </mesh>
      <mesh position={[0, 0.82, 0]} rotation={[0, 0.15, 0]}>
        <planeGeometry args={[1.05, 1.9]} />
        <FireMaterial wrap={false} />
      </mesh>
      <mesh position={[0, 0.76, 0]} rotation={[0, 1.05, 0]}>
        <planeGeometry args={[0.9, 1.7]} />
        <FireMaterial wrap={false} />
      </mesh>
      <mesh position={[0, 0.7, 0]} rotation={[0, 2.1, 0]}>
        <planeGeometry args={[0.78, 1.5]} />
        <FireMaterial wrap={false} />
      </mesh>
      <mesh position={[0, 0.32, 0]}>
        <sphereGeometry args={[0.16, 10, 8]} />
        <meshBasicMaterial
          color="#ffe7a0"
          transparent
          opacity={0.35}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function Smoke() {
  const mats = useRef<(THREE.ShaderMaterial | null)[]>([]);
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.1);
    for (const m of mats.current) {
      if (m) m.uniforms.uTime.value += d;
    }
  });

  return (
    <group position={[0, 0.9, 0]}>
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={i}
          position={[
            Math.sin(i * 1.3) * 0.12,
            0.4 + i * 0.22,
            Math.cos(i * 1.1) * 0.1,
          ]}
          rotation={[0, i * 0.7, 0]}
        >
          <planeGeometry args={[0.9 + i * 0.18, 1.3 + i * 0.2]} />
          <shaderMaterial
            ref={(el) => {
              mats.current[i] = el;
            }}
            uniforms={{
              uTime: { value: i * 1.4 },
              uSpeed: { value: 0.45 + i * 0.08 },
              uOpacity: { value: 0.11 - i * 0.015 },
            }}
            vertexShader={SMOKE_VERT}
            fragmentShader={SMOKE_FRAG}
            transparent
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

function Sparks() {
  const ref = useRef<THREE.Points>(null);
  const data = useMemo(() => {
    const count = 52;
    const positions = new Float32Array(count * 3);
    const sparks = Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * 0.35,
      y: 0.2 + Math.random() * 0.4,
      z: (Math.random() - 0.5) * 0.35,
      vx: (Math.random() - 0.5) * 0.15,
      vy: 0.55 + Math.random() * 0.7,
      vz: (Math.random() - 0.5) * 0.15,
      life: Math.random(),
      max: 0.7 + Math.random() * 0.9,
    }));
    return { count, positions, sparks };
  }, []);

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.1);
    const { sparks, positions } = data;
    for (let i = 0; i < sparks.length; i++) {
      const s = sparks[i];
      s.life += d;
      if (s.life >= s.max) {
        s.life = 0;
        s.x = (Math.random() - 0.5) * 0.32;
        s.y = 0.18 + Math.random() * 0.2;
        s.z = (Math.random() - 0.5) * 0.32;
        s.vx = (Math.random() - 0.5) * 0.18;
        s.vy = 0.5 + Math.random() * 0.85;
        s.vz = (Math.random() - 0.5) * 0.18;
        s.max = 0.65 + Math.random() * 1.0;
      }
      s.x += s.vx * d;
      s.y += s.vy * d;
      s.z += s.vz * d;
      s.vy += 0.12 * d;
      positions[i * 3] = s.x;
      positions[i * 3 + 1] = s.y;
      positions[i * 3 + 2] = s.z;
    }
    const attr = ref.current?.geometry.getAttribute("position");
    if (attr) attr.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[data.positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        color="#ffc46a"
        size={0.045}
        sizeAttenuation
        transparent
        opacity={0.9}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}

function Glow() {
  const tex = useMemo(() => makeGlowTexture(), []);
  const inner = useRef<THREE.Mesh>(null);
  const outer = useRef<THREE.Mesh>(null);
  useEffect(() => () => tex.dispose(), [tex]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const pulse = 1 + Math.sin(t * 3.2) * 0.07 + Math.sin(t * 7.1) * 0.04;
    if (inner.current) inner.current.scale.setScalar(0.82 * pulse);
    if (outer.current) outer.current.scale.setScalar(1.55 * pulse);
  });

  return (
    <Billboard position={[0, 0.55, 0]} follow>
      <mesh ref={inner}>
        <planeGeometry args={[1.6, 1.6]} />
        <meshBasicMaterial
          map={tex}
          transparent
          opacity={0.55}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          color="#ff9a42"
        />
      </mesh>
      <mesh ref={outer}>
        <planeGeometry args={[1.6, 1.6]} />
        <meshBasicMaterial
          map={tex}
          transparent
          opacity={0.22}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          color="#ff6a22"
        />
      </mesh>
    </Billboard>
  );
}

function Coals() {
  const maps = useCampMaps();
  const refs = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    for (let i = 0; i < refs.current.length; i++) {
      const m = refs.current[i];
      if (!m) continue;
      m.emissiveIntensity =
        0.55 + Math.sin(t * (2.4 + (i % 5) * 0.35) + i) * 0.35;
    }
  });

  return (
    <group>
      {COALS.map((c, i) => (
        <mesh
          key={i}
          position={[Math.cos(c.az) * c.dist, c.y, Math.sin(c.az) * c.dist]}
          rotation={[c.phase, c.az, c.phase * 0.4]}
          castShadow
        >
          <dodecahedronGeometry args={[c.s, 0]} />
          <meshStandardMaterial
            ref={(el) => {
              refs.current[i] = el;
            }}
            map={maps.charred}
            color="#2a1a12"
            emissive="#ff4a12"
            emissiveIntensity={0.7}
            roughness={0.7}
            metalness={0.05}
          />
        </mesh>
      ))}
    </group>
  );
}

function StoneRing() {
  const maps = useCampMaps();
  const geos = useMemo(() => STONES.map((s) => makeRockGeometry(s.seed)), []);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);

  return (
    <group>
      {STONES.map((s, i) => (
        <mesh
          key={i}
          geometry={geos[i]}
          position={[Math.cos(s.az) * s.dist, 0, Math.sin(s.az) * s.dist]}
          rotation={s.rot}
          scale={s.scale}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial
            map={maps.stone}
            color={new THREE.Color().setScalar(s.tint)}
            roughness={0.92}
            metalness={0.04}
            bumpMap={maps.stone}
            bumpScale={0.045}
          />
        </mesh>
      ))}
    </group>
  );
}

function Logs() {
  const maps = useCampMaps();
  return (
    <group>
      {LOGS.map((log, i) => (
        <group
          key={i}
          position={[
            Math.cos(log.az) * log.dist,
            log.y,
            Math.sin(log.az) * log.dist,
          ]}
          rotation={[0, -log.az, log.tilt]}
        >
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
            <cylinderGeometry args={[log.r * 0.88, log.r, log.len, 10, 1]} />
            <meshStandardMaterial
              attach="material-0"
              map={log.charred ? maps.charred : maps.bark}
              roughness={log.charred ? 0.7 : 0.84}
              metalness={0}
              emissive={log.charred ? "#ff3a0c" : "#000000"}
              emissiveIntensity={log.charred ? 0.18 : 0}
            />
            <meshStandardMaterial
              attach="material-1"
              map={maps.endgrain}
              roughness={0.72}
            />
            <meshStandardMaterial
              attach="material-2"
              map={maps.endgrain}
              roughness={0.72}
            />
          </mesh>
        </group>
      ))}
      {KINDLING.map((k, i) => (
        <group
          key={`k-${i}`}
          position={[
            Math.cos(k.az) * k.dist,
            k.y,
            Math.sin(k.az) * k.dist,
          ]}
          rotation={[0.4, -k.az, k.tilt]}
        >
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[k.r * 0.8, k.r, k.len, 6, 1]} />
            <meshStandardMaterial map={maps.bark} roughness={0.86} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function AshBed() {
  const maps = useCampMaps();
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} receiveShadow>
      <circleGeometry args={[0.85, 28]} />
      <meshStandardMaterial
        map={maps.ash}
        roughness={1}
        metalness={0}
        color="#c8c2b8"
      />
    </mesh>
  );
}

function FireLight() {
  const ref = useRef<THREE.PointLight>(null);
  const mode = useViewer((s) => s.mode);

  useFrame(({ clock }) => {
    const light = ref.current;
    if (!light) return;
    const t = clock.elapsedTime;
    const flicker =
      1 +
      Math.sin(t * 8.2) * 0.07 +
      Math.sin(t * 13.6) * 0.045 +
      Math.sin(t * 3.1) * 0.03;
    const base = mode === "night" ? 16 : 5;
    light.intensity = base * flicker;
  });

  return (
    <pointLight
      ref={ref}
      position={[0, 0.7, 0]}
      color="#ff7a32"
      intensity={16}
      distance={16}
      decay={2}
    />
  );
}

export function HubCampfire() {
  const { x, y, z } = HUB.campfire.position;
  return (
    <group position={[x, y, z]}>
      <AshBed />
      <StoneRing />
      <Logs />
      <Coals />
      <Flames />
      <Smoke />
      <Sparks />
      <Glow />
      <FireLight />
    </group>
  );
}
