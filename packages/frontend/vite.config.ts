import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    /*
     * Proxy /api requests to the engine API server.
     * In local dev, the frontend runs on :5173 and the engine
     * API runs on :3001. This proxy makes them appear as one
     * origin, avoiding CORS issues.
     */
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
