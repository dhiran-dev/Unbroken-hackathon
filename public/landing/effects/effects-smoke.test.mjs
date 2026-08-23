import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const source = await readFile(new URL("./init-effects.js", import.meta.url), "utf8");
const bundle = await readFile(
  new URL("./canvasui-effects.bundle.js", import.meta.url),
  "utf8",
);

assert.match(html, /<script defer src="\/landing\/effects\/canvasui-effects\.bundle\.js"><\/script>/);
assert.doesNotMatch(html, /<script type="module" src="effects\/init-effects\.js">/);
assert.match(html, /\.hero-bottom-frost\s*\{[\s\S]*?radial-gradient\(/);
assert.doesNotMatch(html, /hero-copy__frost-panel/);
assert.match(html, /\.can-droplets-canvas\s*\{[\s\S]*?clip-path:\s*polygon\(/);
assert.doesNotMatch(
  html,
  /\.can-droplets-canvas\s*\{[\s\S]*?mask:\s*url\("\/landing\/assets\/new_can\.png"\)/,
);
assert.match(source, /location\.protocol !== "file:"/);
assert.match(source, /tintStrength:\s*0/);
assert.ok(bundle.length > 40_000, "CanvasUI browser bundle is unexpectedly small");
assert.doesNotMatch(bundle, /^\s*import\s/m);

console.log("CanvasUI effects smoke test passed");
