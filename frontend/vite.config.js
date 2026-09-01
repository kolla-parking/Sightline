import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  // In production the console is published under /console/ on the combined
  // static site (see render.yaml); dev keeps root so /login etc. work at 5173.
  base: command === "build" ? "/console/" : "/",
  plugins: [react()],
  server: {
    port: 5173,
  },
  optimizeDeps: {
    // pre-bundling maplibre-gl breaks its internal worker bootstrap in dev
    exclude: ["maplibre-gl"],
  },
}));
