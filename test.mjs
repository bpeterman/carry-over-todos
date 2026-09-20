import esbuild from "esbuild";

const result = await esbuild.build({
  entryPoints: ["source-selection.test.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  target: "node16",
});

const source = result.outputFiles[0].text;
await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
