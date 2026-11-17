<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Aeyhey logo

The mark is the letter a with its bowl drawn as an arrow coming back round, followed by a
full stop: the things you saved, coming back to you.

## Files

| File                               | What it is                                                         |
| ---------------------------------- | ------------------------------------------------------------------ |
| `aeyhey-mark.svg`                  | The app icon: the white glyph on an indigo rounded tile.           |
| `aeyhey-glyph.svg`                 | The glyph alone, in `currentColor`, for placing on any background. |
| `aeyhey-mark-maskable.svg`         | A full square with the glyph smaller, for Android's icon masks.    |
| `aeyhey-lockup.svg`                | The mark beside the word "aeyhey", for a light background.         |
| `aeyhey-lockup-on-dark.svg`        | The same, with light text, for a dark background.                  |
| `favicon.ico`                      | 16, 32 and 48 pixel icons in one file.                             |
| `png/aeyhey-mark-*.png`            | The app icon at 16, 32, 48, 64, 128, 180, 192, 256, 512 and 1024.  |
| `png/aeyhey-mark-maskable-512.png` | The maskable icon as a PNG.                                        |

The SVG files are the source. Everything else is generated from them.

## Colour

The tile is indigo, `#5b50e6`, and the glyph is white. Inside the app the tile takes the
accent of whichever colour theme is chosen, so the mark is drawn inline there (see
`BrandMark` in `apps/web/components/nav.tsx`) rather than loaded from these files. If you
change the drawing, change it in both places.

## The word beside the mark

The two lockup files set "aeyhey" as live text in Inter, falling back to the system sans
serif, so the letters look slightly different on a machine without Inter. For print, or
anywhere the exact letterforms matter, open the file in a vector editor and convert the
text to outlines first.

## Rebuilding

After changing an SVG:

```bash
node assets/logo/build.mjs
```

That regenerates the PNGs and `favicon.ico`, and copies the ones the web app serves into
`apps/web/app` (`icon.svg`, `favicon.ico`, `apple-icon.png`) and `apps/web/public/icons`.
It needs `rsvg-convert` (macOS: `brew install librsvg`).
