/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import tailwindConfig from "./tailwind.config.js";
export default defineConfig({
  plugins: [react()],
  // vitest 只负责前端测试；server/ 的用 node --test（pnpm server:test）
  test: { include: ["src/**/*.{test,spec}.{ts,tsx}"] },
  build: { outDir: "target/frontend", emptyOutDir: true },
  server: { port: 5173, strictPort: true },
  css: { postcss: { plugins: [tailwindcss(tailwindConfig)] } },
});
