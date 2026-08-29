import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// VR=1 npm run dev  ->  https на всю локальную сеть (нужно для WebXR на Quest).
// Иначе обычный http (быстрее, годится для десктопа и телефона в LAN).
const vr = process.env.VR === "1";

export default defineConfig({
  plugins: vr ? [basicSsl()] : [],
  server: {
    host: true, // доступ по локальной сети
    port: 5173,
  },
  build: {
    target: "es2020",
    outDir: "dist",
    chunkSizeWarningLimit: 2000,
  },
});
