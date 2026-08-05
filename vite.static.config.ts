import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.TERNARY_BASE_PATH ?? "/ternary/",
  plugins: [react()],
  build: {
    outDir: "static-dist",
    emptyOutDir: true,
    sourcemap: false,
  },
});
