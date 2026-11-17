# icons

The installable-app icons the manifest points at: `icon-192.png`, `icon-512.png` and
`icon-512-maskable.png`. The maskable one keeps its artwork inside the middle 80 percent,
because Android crops it to whatever shape the launcher uses.

These are generated. The source drawings are in `assets/logo` at the repo root; change
them there and run `node assets/logo/build.mjs`, which rewrites these files.
