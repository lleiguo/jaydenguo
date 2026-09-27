import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The web app may seal secrets but never open them (spec CRED-4, §7.3).
  // Cloud KMS IAM enforces this in production; this catches it in review.
  {
    files: ["src/app/**", "src/components/**", "src/proxy.ts", "src/server/**"],
    ignores: ["src/server/crypto/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/crypto/envelope"],
              importNames: ["open", "rewrap"],
              message: "Only worker jobs may decrypt credentials.",
            },
            { group: ["**/worker/**", "@/worker/*"], message: "Web code must not import worker jobs." },
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
    "dist/**",
  ]),
]);

export default eslintConfig;
