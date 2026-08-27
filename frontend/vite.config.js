import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  optimizeDeps: {
    // pre-bundling maplibre-gl breaks its internal worker bootstrap in dev
    exclude: ["maplibre-gl"],
  },
});
