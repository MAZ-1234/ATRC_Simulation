import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// The built app must open from disk (file://). Everything the app needs (JS, CSS,
// fonts) is inlined into dist/index.html; the simulation data stays in dist/data/
// (copied from public/data/) and is loaded as classic <script> files, not fetched.
export default defineConfig({
  base: "./",
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    reportCompressedSize: false,
    chunkSizeWarningLimit: 4000,
  },
  server: { port: 5173, open: false },
});
