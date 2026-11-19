// Bundle the TypeScript tests (and the src modules they import) with
// esbuild, then run them with node's built-in test runner.
import { build } from "esbuild";
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const testFiles = readdirSync(here("../tests"))
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => here(`../tests/${f}`));

await build({
  entryPoints: testFiles,
  outdir: here("../tests-dist"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
  logLevel: "silent",
});

const result = spawnSync(process.execPath, ["--test", "tests-dist/*.test.js"], {
  stdio: "inherit",
  cwd: here(".."),
});
process.exit(result.status ?? 1);
