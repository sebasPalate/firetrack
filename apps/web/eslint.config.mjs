import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Dependency rule: shared/ knows nothing about the product; features/ never reach up into the page.
  {
    files: ["src/shared/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/*", "@/dashboard/*", "**/features/*", "**/dashboard/*"],
              message: "shared/ must not import from features/ or dashboard/.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/features/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/dashboard/*", "**/dashboard/*"], message: "features/ must not import from dashboard/." },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
