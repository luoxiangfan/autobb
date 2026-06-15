import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config";

const baseTest = (baseConfig as { test?: { exclude?: string[] } }).test ?? {};
const exclude = baseTest.exclude ?? [];

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseTest,
    include: ["src/gateway/**/*.test.ts"],
    exclude,
  },
});
