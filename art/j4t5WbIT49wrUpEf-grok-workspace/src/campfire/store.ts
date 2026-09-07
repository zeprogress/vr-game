import { create } from "zustand";

export type LightMode = "day" | "night";

type ViewerState = {
  mode: LightMode;
  autoRotate: boolean;
  muted: boolean;
  resetNonce: number;
  setMode: (mode: LightMode) => void;
  toggleAutoRotate: () => void;
  toggleMuted: () => void;
  resetCamera: () => void;
};

export const useViewer = create<ViewerState>((set) => ({
  mode: "night",
  autoRotate: true,
  muted: false,
  resetNonce: 0,
  setMode: (mode) => set({ mode }),
  toggleAutoRotate: () => set((s) => ({ autoRotate: !s.autoRotate })),
  toggleMuted: () => set((s) => ({ muted: !s.muted })),
  resetCamera: () => set((s) => ({ resetNonce: s.resetNonce + 1 })),
}));
