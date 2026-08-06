import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/runner/vitest.ts", "src/cli/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node20",
});
