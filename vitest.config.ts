import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "@db": path.resolve(__dirname, "db") } },
  test: {
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          fileParallelism: false,
          env: { FETCH_MIN_GAP_MS: "0" },
        },
      },
    ],
  },
});
