import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true, // доступ по локальной сети (телефон в той же Wi-Fi)
    port: 5173,
  },
  build: {
    target: "es2020",
    outDir: "dist",
  },
});
