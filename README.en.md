<div align="center">

# NAIS3

<img src="build/icon-win.png" width="128" alt="NAIS3" />

**NovelAI Image Studio 3** — A desktop app for NovelAI image generation

[![Patreon](https://img.shields.io/badge/Patreon-Support-FF424D?logo=patreon&logoColor=white)](https://www.patreon.com/c/sunakgo)
[![License](https://img.shields.io/badge/License-GPL--3.0-blue)](LICENSE)

[한국어](README.md) · English

</div>

---

NAIS3 is the successor to NAIS2, a desktop application built to make NovelAI image generation fast and reliable. It is designed for heavy users who manage hundreds of characters and presets and generate tens of thousands of images.

## Features

- **Generation** — Text-to-image, image-to-image, and inpainting. Byte-for-byte payload parity with the NovelAI web app for consistent seeds, plus live streaming previews
- **Prompt comments** — Text from `#` to the end of the line is treated as a comment and excluded from requests (supported in base, character, and fragment prompts; shown with a gray background)
- **Character prompts** — Save characters to a library, organize them into folders, set their positions, and activate up to six at once
- **Fragments (wildcards)** — Insert fragments into prompts with `<name>`; randomly select one of multiple lines
- **Vibe Transfer / Character Reference** — Manage images in a library with cached encodings
- **Scene mode** — Save prompts for each scene, queue them, and generate in batches
- **Director tools** — Background removal, line art, sketches, colorization, expression changes, image cleanup, and upscaling
- **Metadata** — Read prompts, parameters, characters, UC presets, and quality tags from PNG metadata and stealth chunks
- **Prompt presets** — Save and load frequently used prompt and negative prompt pairs
- **Backups** — Export and import workspace data and library assets as `.nais` files (also supports importing legacy NAIS3 and NAIS2 JSON backups)
- **Automatic updates** — Based on GitHub Releases
- **More** — Light and dark themes, estimated Anlas usage, tag autocomplete (including artist tags), and keyboard shortcuts

## Download

Get the latest version from [Releases](../../releases). (macOS `.dmg` / Windows `.exe`)

## Tech stack

- [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.org/)
- [React](https://react.dev/) 19 + [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/) v4
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (local database) · [Zustand](https://github.com/pmndrs/zustand) · [sharp](https://sharp.pixelplumbing.com/)

## Development

```bash
pnpm install      # Install dependencies
pnpm run dev      # Start development mode
pnpm run dev:web  # Start browser development mode (127.0.0.1:5173)
pnpm run build    # Typecheck and build
pnpm test         # Run tests
pnpm run test:db  # Verify real SQLite upgrades and backups (Electron Node mode)

# Packaging
pnpm run build:mac    # macOS (.dmg)
pnpm run build:win    # Windows (.exe)
```

Browser development mode uses an IndexedDB workspace separate from Electron.
API tokens are stored in the development browser profile and are not included in workspace JSON backups.
Browser backups are restored in browser mode, and restoring preserves the currently registered accounts.
Scene/fragment ZIP handling and the embedded webview are only available in Electron.

See the [release guide](RELEASING.md) for tag builds, draft validation, and publishing releases.

## Contributing translations

The UI supports Korean, English, and Simplified Chinese. You can change the language under Settings → Appearance → Language.
Translations are managed in per-language catalogs with stable message IDs.
See the [translation contribution guide](CONTRIBUTING.md) for instructions on editing text and adding languages.
Validate translation changes with `pnpm i18n:check`.

## Support

- ❤️ **Patreon**: <https://www.patreon.com/c/sunakgo>

## Thanks to

The following projects served as references for understanding the NovelAI API:

- **SDStudio**
- **NAIA 2.0**

## License

This project is distributed under the [GNU General Public License v3.0](LICENSE).
