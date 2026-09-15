import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import tailwindConfig from "./tailwind.config.js";
export default defineConfig({
  plugins: [react()],
  build: { outDir: "target/frontend", emptyOutDir: true },
  server: { port: 5173, strictPort: true },
  css: { postcss: { plugins: [tailwindcss(tailwindConfig)] } },
});
