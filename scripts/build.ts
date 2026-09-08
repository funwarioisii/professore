import { build } from "esbuild";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { Project } from "../src/core/schema.ts";
await fs.mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/web/slide.tsx", "src/web/app.tsx"],
  outdir: "dist",
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2022",
  logLevel: "warning",
});
await fs.copyFile("src/web/slide.css", "dist/slide.css");
await fs.copyFile("src/web/app.css", "dist/app.css");
await fs.writeFile(
  "dist/index.html",
  '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Professore</title><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>',
);
await fs.mkdir("schema", { recursive: true });
await fs.writeFile(
  "schema/project.schema.json",
  JSON.stringify(z.toJSONSchema(Project), null, 2),
);
await fs.writeFile(
  "dist/preview.html",
  '<!doctype html><html lang="ja"><meta charset="utf-8"><link rel="stylesheet" href="/slide.css"><div id="root"></div><script src="/slide.js"></script></html>',
);
