// SPDX-License-Identifier: AGPL-3.0-only
// Rebuilds every raster file from the SVG sources in this folder, and copies the ones the
// web app serves into apps/web. Run it after changing an SVG:
//
//   node assets/logo/build.mjs
//
// It needs `rsvg-convert` on the PATH (macOS: brew install librsvg; Debian: apt install
// librsvg2-bin). Nothing here runs at build time or in CI: the outputs are committed.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const png = join(here, "png");
const web = join(here, "..", "..", "apps", "web");

function render(source, size, target) {
  execFileSync("rsvg-convert", [
    "--width",
    String(size),
    "--height",
    String(size),
    "--output",
    target,
    join(here, source),
  ]);
}

/** An .ico is a small directory followed by the images, which may simply be PNGs. */
function ico(sources, target) {
  const images = sources.map((file) => readFileSync(file));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = header.length;
  images.forEach((image, index) => {
    const size = image.readUInt32BE(16);
    const entry = 6 + 16 * index;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });

  writeFileSync(target, Buffer.concat([header, ...images]));
}

mkdirSync(png, { recursive: true });

const SIZES = [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024];
for (const size of SIZES) render("aeyhey-mark.svg", size, join(png, `aeyhey-mark-${size}.png`));
render("aeyhey-mark-maskable.svg", 512, join(png, "aeyhey-mark-maskable-512.png"));

ico(
  [16, 32, 48].map((size) => join(png, `aeyhey-mark-${size}.png`)),
  join(here, "favicon.ico"),
);

// What the web app serves. Next picks up app/icon.svg, app/favicon.ico and
// app/apple-icon.png by name; the manifest points at public/icons.
mkdirSync(join(web, "public", "icons"), { recursive: true });
copyFileSync(join(here, "aeyhey-mark.svg"), join(web, "app", "icon.svg"));
copyFileSync(join(here, "favicon.ico"), join(web, "app", "favicon.ico"));
copyFileSync(join(png, "aeyhey-mark-180.png"), join(web, "app", "apple-icon.png"));
copyFileSync(join(png, "aeyhey-mark-192.png"), join(web, "public", "icons", "icon-192.png"));
copyFileSync(join(png, "aeyhey-mark-512.png"), join(web, "public", "icons", "icon-512.png"));
copyFileSync(
  join(png, "aeyhey-mark-maskable-512.png"),
  join(web, "public", "icons", "icon-512-maskable.png"),
);

console.log(`Built ${SIZES.length + 1} PNGs and favicon.ico, and updated apps/web.`);
