import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";

export type CampMaps = {
  bark: THREE.Texture;
  stone: THREE.Texture;
  dirt: THREE.Texture;
  grass: THREE.Texture;
  charred: THREE.Texture;
  endgrain: THREE.Texture;
  ash: THREE.Texture;
};

const MapsContext = createContext<CampMaps | null>(null);

function prep(tex: THREE.Texture, repeatX = 1, repeatY = 1, anisotropy = 8) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function CampMapsProvider({ children }: { children: ReactNode }) {
  const gl = useThree((s) => s.gl);
  const [bark, stone, dirt, grass, charred, endgrain, ash] = useTexture([
    "/textures/wood-bark.jpg",
    "/textures/stone.jpg",
    "/textures/dirt.jpg",
    "/textures/grass.jpg",
    "/textures/charred.jpg",
    "/textures/endgrain.jpg",
    "/textures/ash.jpg",
  ]);

  const maps = useMemo<CampMaps>(() => {
    const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
    return {
      bark: prep(bark, 1.4, 1, aniso),
      stone: prep(stone, 1, 1, aniso),
      dirt: prep(dirt.clone(), 4, 4, aniso),
      grass: prep(grass.clone(), 14, 14, aniso),
      charred: prep(charred, 1.2, 1, aniso),
      endgrain: prep(endgrain, 1, 1, aniso),
      ash: prep(ash.clone(), 2, 2, aniso),
    };
  }, [ash, bark, charred, dirt, endgrain, gl, grass, stone]);

  useLayoutEffect(() => {
    return () => {
      maps.dirt.dispose();
      maps.grass.dispose();
      maps.ash.dispose();
    };
  }, [maps]);

  return <MapsContext.Provider value={maps}>{children}</MapsContext.Provider>;
}

export function useCampMaps() {
  const maps = useContext(MapsContext);
  if (!maps) throw new Error("useCampMaps must be used inside CampMapsProvider");
  return maps;
}
