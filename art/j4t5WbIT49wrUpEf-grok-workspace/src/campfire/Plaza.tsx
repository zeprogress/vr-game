import { useMemo } from "react";
import * as THREE from "three";
import { HUB } from "@/shared/hub";
import { makeRockGeometry } from "./geometry";
import { useCampMaps } from "./maps";

function Bench({ azimuth, distance }: { azimuth: number; distance: number }) {
  const maps = useCampMaps();
  const x = Math.cos(azimuth) * distance;
  const z = Math.sin(azimuth) * distance;
  return (
    <group position={[x, 0, z]} rotation={[0, -azimuth + Math.PI / 2, 0]}>
      <mesh
        position={[0, 0.2, 0]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[0.09, 0.1, 1.15, 8]} />
        <meshStandardMaterial
          attach="material-0"
          map={maps.bark}
          roughness={0.88}
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
      <mesh position={[-0.38, 0.07, 0]} castShadow>
        <boxGeometry args={[0.14, 0.14, 0.16]} />
        <meshStandardMaterial map={maps.bark} roughness={0.9} />
      </mesh>
      <mesh position={[0.38, 0.07, 0]} castShadow>
        <boxGeometry args={[0.14, 0.14, 0.16]} />
        <meshStandardMaterial map={maps.bark} roughness={0.9} />
      </mesh>
    </group>
  );
}

function Pine({
  position,
  scale = 1,
}: {
  position: [number, number, number];
  scale?: number;
}) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.7, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.16, 1.4, 6]} />
        <meshStandardMaterial color="#4a321c" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.7, 0]} castShadow>
        <coneGeometry args={[1.15, 1.8, 7]} />
        <meshStandardMaterial color="#2c3d22" roughness={0.88} />
      </mesh>
      <mesh position={[0, 2.55, 0]} castShadow>
        <coneGeometry args={[0.85, 1.5, 7]} />
        <meshStandardMaterial color="#334826" roughness={0.88} />
      </mesh>
      <mesh position={[0, 3.25, 0]} castShadow>
        <coneGeometry args={[0.52, 1.2, 7]} />
        <meshStandardMaterial color="#3b5229" roughness={0.88} />
      </mesh>
    </group>
  );
}

function Lantern({ azimuth, distance }: { azimuth: number; distance: number }) {
  const maps = useCampMaps();
  const x = Math.cos(azimuth) * distance;
  const z = Math.sin(azimuth) * distance;
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.7, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.08, 1.4, 6]} />
        <meshStandardMaterial map={maps.bark} roughness={0.86} />
      </mesh>
      <mesh position={[0, 1.48, 0]}>
        <boxGeometry args={[0.22, 0.28, 0.22]} />
        <meshStandardMaterial
          color="#f0c070"
          emissive="#ff9a3a"
          emissiveIntensity={0.85}
          roughness={0.4}
        />
      </mesh>
      <mesh position={[0, 1.66, 0]}>
        <boxGeometry args={[0.26, 0.05, 0.26]} />
        <meshStandardMaterial color="#3a2a1c" roughness={0.8} />
      </mesh>
      <pointLight
        position={[0, 1.48, 0]}
        color="#ffb060"
        intensity={4}
        distance={6}
        decay={2}
      />
    </group>
  );
}

function WoodPile() {
  const maps = useCampMaps();
  const logs = [
    { y: 0.08, z: 0, rot: 0.08 },
    { y: 0.08, z: 0.16, rot: -0.04 },
    { y: 0.08, z: -0.16, rot: 0.12 },
    { y: 0.24, z: 0.08, rot: 0.2 },
    { y: 0.24, z: -0.07, rot: -0.15 },
    { y: 0.4, z: 0.01, rot: 0.05 },
  ];
  return (
    <group position={[2.55, 0, -1.35]} rotation={[0, 0.6, 0]}>
      {logs.map((l, i) => (
        <mesh
          key={i}
          position={[0, l.y, l.z]}
          rotation={[0, l.rot, Math.PI / 2]}
          castShadow
          receiveShadow
        >
          <cylinderGeometry args={[0.07, 0.08, 1.05, 8]} />
          <meshStandardMaterial
            attach="material-0"
            map={maps.bark}
            roughness={0.86}
          />
          <meshStandardMaterial
            attach="material-1"
            map={maps.endgrain}
            roughness={0.7}
          />
          <meshStandardMaterial
            attach="material-2"
            map={maps.endgrain}
            roughness={0.7}
          />
        </mesh>
      ))}
    </group>
  );
}

function ScatterRocks() {
  const maps = useCampMaps();
  const rocks = useMemo(
    () => [
      { pos: [2.1, 0, 1.8] as const, scale: 0.22, seed: 9 },
      { pos: [-2.4, 0, 1.1] as const, scale: 0.18, seed: 21 },
      { pos: [-1.8, 0, -2.2] as const, scale: 0.26, seed: 33 },
      { pos: [3.2, 0, 0.4] as const, scale: 0.16, seed: 44 },
    ],
    [],
  );
  const geos = useMemo(
    () => rocks.map((r) => makeRockGeometry(r.seed)),
    [rocks],
  );
  return (
    <group>
      {rocks.map((r, i) => (
        <mesh
          key={i}
          geometry={geos[i]}
          position={r.pos as unknown as [number, number, number]}
          scale={r.scale}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial map={maps.stone} roughness={0.94} />
        </mesh>
      ))}
    </group>
  );
}

export function Plaza() {
  const maps = useCampMaps();
  const dirtR = HUB.plaza.dirtRadius;

  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.02, 0]}
        receiveShadow
      >
        <planeGeometry args={[42, 42]} />
        <meshStandardMaterial
          map={maps.grass}
          roughness={0.95}
          color="#7a8a5a"
        />
      </mesh>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.002, 0]}
        receiveShadow
      >
        <circleGeometry args={[dirtR, 48]} />
        <meshStandardMaterial map={maps.dirt} roughness={0.98} color="#8a6a48" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[2.35, 32]} />
        <meshBasicMaterial color="#1a120e" transparent opacity={0.38} />
      </mesh>
      {HUB.benches.map((b) => (
        <Bench key={b.azimuth} azimuth={b.azimuth} distance={b.distance} />
      ))}
      <Lantern azimuth={1.05} distance={4.6} />
      <Lantern azimuth={4.2} distance={4.85} />
      <WoodPile />
      <ScatterRocks />
      <Pine position={[8.5, 0, -6.2]} scale={1.15} />
      <Pine position={[11.2, 0, -2.4]} scale={0.95} />
      <Pine position={[9.8, 0, 5.5]} scale={1.25} />
      <Pine position={[-9.4, 0, 4.8]} scale={1.1} />
      <Pine position={[-11.5, 0, -3.2]} scale={1.35} />
      <Pine position={[-7.2, 0, -8.4]} scale={0.9} />
      <Pine position={[5.4, 0, -10.5]} scale={1.05} />
      <Pine position={[-4.8, 0, 10.2]} scale={1.2} />
    </group>
  );
}
