import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/ternary/",
  plugins: [react()],
  build: {
    outDir: "static-dist",
    emptyOutDir: true,
    sourcemap: false,
  },
});
