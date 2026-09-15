import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**", "target/**", ".pnpm-store/**", ".agents/**", ".workbuddy/**", ".agy-staff/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
