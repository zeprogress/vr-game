import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import * as THREE from "three";
import { Atmosphere } from "./Atmosphere";
import { HubCampfire } from "./HubCampfire";
import { CampMapsProvider } from "./maps";
import { Plaza } from "./Plaza";

export function CampCanvas() {
  return (
    <Canvas
      shadows
      dpr={[1, 1.6]}
      camera={{ position: [5.1, 2.45, 6.3], fov: 38, near: 0.1, far: 90 }}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 0.92,
      }}
      onCreated={({ gl }) => {
        gl.setClearColor("#07080c");
      }}
      style={{ touchAction: "none" }}
    >
      <Suspense fallback={null}>
        <CampMapsProvider>
          <Atmosphere />
          <Plaza />
          <HubCampfire />
        </CampMapsProvider>
      </Suspense>
    </Canvas>
  );
}
