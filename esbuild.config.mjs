import esbuild from "esbuild";

const prod = process.argv[2] !== "--watch";

const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  target: "es2018",
  outfile: "main.js",
  sourcemap: prod ? false : "inline",
  logLevel: "info",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
