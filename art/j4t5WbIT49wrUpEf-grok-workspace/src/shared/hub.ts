/** Gameplay numbers for the HUB campfire. Shared with any future ZoneRoom wiring. */
export const HUB = {
  campfire: {
    position: { x: 0, y: 0, z: 0 },
    /** Outer radius of the stone ring, metres. */
    radius: 2,
  },
  plaza: {
    /** Dirt circle around the fire, metres. Viewer uses a compact slice of the 25 m plaza. */
    dirtRadius: 5.6,
  },
  benches: [
    { azimuth: 0.45, distance: 3.7 },
    { azimuth: 2.15, distance: 3.85 },
    { azimuth: 3.7, distance: 3.62 },
    { azimuth: 5.35, distance: 3.78 },
  ],
} as const;
