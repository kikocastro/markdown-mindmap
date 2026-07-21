import { defineConfig } from "vitest/config";

// Pure logic only (src/graph.ts is Obsidian-free), so the default node env is enough.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // measure the pure core only; the host adapters (Obsidian/VS Code DOM) and
      // the shared SVG renderer are validated by build + manual run, not unit tests
      include: ["src/**/*.ts"],
      exclude: ["src/obsidian/**", "src/vscode/**", "src/render/**"],
      reporter: ["text", "text-summary", "json-summary"],
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 100,
      },
    },
  },
});
