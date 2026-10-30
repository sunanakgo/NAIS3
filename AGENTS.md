# Agent guide

## Project

NAIS3 is a desktop application for NovelAI image generation. It uses Electron,
React, TypeScript, Tailwind CSS, Zustand, and a local SQLite database. A browser
development mode provides a separate IndexedDB workspace.

Use the pnpm version pinned in `package.json` and preserve `pnpm-lock.yaml`.
Read the relevant code and existing documentation before changing behavior.

## License

NAIS3 is licensed under the GNU General Public License v3.0 (`LICENSE`).
Anyone who distributes NAIS3 or a modified version, including packaged builds,
must make the complete corresponding source code available under the same
license.

- Keep `LICENSE` and existing copyright and license notices intact.
- Check the license of any new dependency, asset, or copied code. Do not add
  anything incompatible with GPLv3, such as proprietary, non-commercial, or
  no-derivatives terms.
- Build release artifacts only from source that is published in the repository,
  so every distributed binary has a matching public commit and tag.

## Source map

- `src/main/`: Electron lifecycle, generation orchestration, filesystem access,
  and native integrations. Start with `index.ts` and `ipc.ts`.
- `src/main/db/`: SQLite storage and migrations.
- `src/preload/`: The bridge between the renderer and Electron.
- `src/shared/`: Shared types, model definitions, and translation catalogs.
  IPC contracts are defined in `src/shared/types.ts`.
- `src/renderer/src/`: React components, Zustand stores, and renderer utilities.
- `tests/`: Unit, renderer, and database integration tests.
- `scripts/`: Database test runners and packaged-app/release validators.
- `.github/workflows/`: Translation checks and release validation/packaging.

## Implementation

- Keep changes focused and preserve unrelated user edits and untracked files.
- Follow existing patterns. Use two-space indentation, single quotes, and no
  semicolons, consistent with the repository's formatting configuration.
- Trace IPC changes through shared types, main-process handlers, preload, and
  renderer callers. Keep filesystem and native operations in the main process.
- For persistence changes, inspect migrations, reads/writes, deletion, and backup
  compatibility. Never use an existing user workspace for migration experiments.
- Keep Electron and browser workspaces separate. Do not assume browser behavior
  proves native database, webview, packaging, or updater behavior.
- For UI changes, preserve keyboard navigation, focus restoration, accessible
  names, translated status/error messages, reduced motion, and theme contrast.
- Follow `CONTRIBUTING.md` for translations. Keep message IDs stable, update all
  registered catalogs, and preserve placeholders and unsaved state across language
  changes. Do not translate user prompts, API fields, storage keys, or filenames.

## Validation

Choose validation that matches the change; do not routinely run the full test
suite or a build. For documentation-only changes, inspect the content and links
and run `git diff --check`.

When local code validation is needed, use the smallest relevant commands:

```sh
pnpm run typecheck
pnpm exec vitest run tests/<relevant-file>.test.ts
pnpm i18n:check
pnpm run test:db
```

`pnpm test` runs both Vitest and the SQLite integration suite. Database tests use
Electron's Node mode and isolated temporary databases. Use them for relevant
migration, storage, or backup changes rather than every edit.

Avoid local packaging builds. Prefer GitHub Actions when packaging validation is
needed and remote execution is authorized. The Release workflow supports manual
dispatch for artifact-only validation; tag-triggered runs create a draft release.
Do not push a version tag merely to test a change. Follow `RELEASING.md` for the
current release procedure.

Report exactly which checks ran and their results. Distinguish static checks,
local tests, CI, and packaged runtime verification; queued or pending CI is not a
passing result.

## Git and pull requests

- Use a dedicated branch for implementation. Check remotes, the target branch,
  and the actual base/head commits before branch or publication work.
- Make incremental commits for coherent changes. Use Conventional Commit titles
  such as `feat:`, `fix:`, `refactor:`, or `docs:`, and sign commits with GPG.
  Verify signatures with `git verify-commit`.
- Keep review-only requests read-only.
- Push, open pull requests, merge, and publish releases only within the user's
  authorized scope. A request to open a PR does not authorize merging it.
- Write PR titles and descriptions in English. Describe the resulting behavior
  and actual validation. Do not include personal instructions or conversation
  history.
- Preserve release tags and published artifacts. Publishing a release is a
  separate action from building or validating its artifacts.
