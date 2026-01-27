import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: "/admin/",
  server: {
    host: "::",
    // Admin UI dev server. Backend (Express) defaultnya di 8080.
    port: 5173,
    hmr: {
      overlay: false,
    },
    // Supaya call ke /api/* tetap tembak backend saat dev
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    // Build output langsung ke folder yang dibaca backend: public/admin/
    outDir: "public/admin",
    emptyOutDir: true,
    assetsDir: "assets",
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
