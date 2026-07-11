# Poster font library — licenses

These TrueType files are bundled so the schema poster renderer (Strategy B) can
outline text to vector paths with `opentype.js`, giving pixel-identical output on
every machine with **no OS font install and no fontconfig**. The fonts travel with
the repo (a `git clone` is all a new worker needs).

All fonts are from [Google Fonts](https://fonts.google.com) and are redistributable:

- **SIL Open Font License 1.1 (OFL)** — most families here. Permits embedding,
  redistribution, and use in commercial work. The font files may be bundled and
  shipped as-is.
- **Apache License 2.0** — Roboto, Open Sans (and Work Sans). Also permits
  embedding and redistribution.

Both licenses allow shipping the font files inside this repository. Outlining a
glyph to a `<path>` (rasterized into a poster PNG) is a normal use of the font,
not a modification of the font software.

Source: files fetched from the Fontsource CDN (`cdn.jsdelivr.net/fontsource`),
which republishes the upstream Google Fonts static instances (latin subset).

See `manifest.json` for the curated list (family, file, weight, category).
