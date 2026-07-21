import esbuild from "esbuild";
import process from "process";
import { builtinModules as builtins } from "node:module";

const prod = process.argv[2] === "production";

// Two adapters share the pure core in src/graph.ts.
// - Obsidian: src/obsidian/main.ts -> main.js (loaded by Obsidian, must stay at repo root)
// - VS Code:  src/vscode/extension.ts -> dist/extension.js (+ webview.js for the panel)
const targets = [
  {
    entryPoints: ["src/obsidian/main.ts"],
    external: ["obsidian", "electron", ...builtins],
    format: "cjs",
    outfile: "main.js",
  },
  {
    entryPoints: ["src/vscode/extension.ts"],
    platform: "node",
    external: ["vscode", ...builtins],
    format: "cjs",
    outfile: "dist/extension.js",
  },
  {
    entryPoints: ["src/vscode/webview.ts"],
    platform: "browser",
    format: "iife",
    outfile: "dist/webview.js",
  },
];

const common = {
  bundle: true,
  target: "es2022",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  logLevel: "info",
};

const ctxs = await Promise.all(
  targets.map((t) => esbuild.context({ ...common, ...t }))
);

if (prod) {
  await Promise.all(ctxs.map((c) => c.rebuild()));
  process.exit(0);
} else {
  await Promise.all(ctxs.map((c) => c.watch()));
}
