import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored Remotion skill — reference material read at runtime by Codex, not app
    // code. Its example .tsx import "remotion" (not an app dep) and must not be
    // type-checked or linted by the Next build.
    "remotion-skill/**",
  ]),
]);

export default eslintConfig;
