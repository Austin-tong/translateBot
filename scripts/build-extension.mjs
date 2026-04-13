import { copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const extensionRoot = resolve(root, "packages/extension");
const dist = resolve(extensionRoot, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: {
    background: resolve(extensionRoot, "src/background.ts"),
    content: resolve(extensionRoot, "src/content.ts"),
    popup: resolve(extensionRoot, "src/popup.ts")
  },
  outdir: dist,
  bundle: true,
  format: "iife",
  target: "chrome120",
  sourcemap: true,
  minify: false,
  logLevel: "info"
});

await copyFile(resolve(extensionRoot, "public/manifest.json"), resolve(dist, "manifest.json"));
await copyFile(resolve(extensionRoot, "public/popup.html"), resolve(dist, "popup.html"));
await copyFile(resolve(extensionRoot, "public/popup.css"), resolve(dist, "popup.css"));
