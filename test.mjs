import esbuild from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dir = await mkdtemp(join(tmpdir(), "carry-over-tests-"));
try {
  for (const entry of ["source-selection.test.ts", "task-blocks.test.ts", "editor-sorting.test.ts", "plugin.test.ts"]) {
    const outfile = join(dir, entry.replace(".ts", ".mjs"));
    await esbuild.build({ entryPoints: [entry], bundle: true, outfile, platform: "node", format: "esm", target: "node16", plugins: [{ name: "mock-obsidian", setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: join(process.cwd(), "obsidian-test-stub.ts") }));
    } }] });
    await import(pathToFileURL(outfile).href);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
