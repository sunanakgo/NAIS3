# Release procedure

Production releases use a stable version such as `1.0.26` in `package.json` and
the matching tag `v1.0.26`. The Release workflow builds **drafts only**.

## Prepare

1. Merge the intended fixes and update `package.json` plus `release-notes/v<version>.md`.
2. Verify author and committer identity, a clean worktree, CI results, and the exact
   commit SHA to tag. Local uncommitted fixes are not included in a tag build.
3. Run `pnpm test` (including real SQLite integration tests) and `pnpm run build`.
4. Tag only the reviewed commit and push only that tag.

## Automated draft checks

The tag workflow checks the tag/app version and release notes, and refuses to
modify an already published release. Builds run separately on Windows x64,
Mac ARM64, Mac Intel x64, and Linux x64. Every platform runs tests and typechecking, packages
with `--publish never`, and exercises the shipped SQLite/sharp dependencies with
the packaged Electron executable in Node mode.

Mac builds additionally verify native module architecture. Each platform validates
its assets; the final aggregation must contain exactly these nine files:

- `latest.yml`
- `nais3-<version>-setup.exe`
- `nais3-<version>-setup.exe.blockmap`
- `nais3-<version>-arm64.dmg`
- `nais3-<version>-arm64-mac.zip`
- `nais3-<version>-x64.dmg`
- `nais3-<version>-x64-mac.zip`
- `latest-linux.yml`
- `nais3-<version>-x86_64.AppImage`

The validator checks Windows and Linux update metadata version, file paths, sizes,
and SHA-512, the AppImage header, and Mac ZIP bundle paths, identifiers, and versions. Run it locally against the
downloaded draft files with `node scripts/verify-release.mjs assets all <directory>`.

## Review and publish

Download and test the **draft's actual artifacts** before publishing. Check clean
installation and upgrade from the previous version on each supported platform,
including stored language, account access, database migration/backup, and restart.
Use a copy of an existing workspace when testing migration.

Publishing as the latest stable release is a separate, explicit action. Once public,
check `/releases/latest`, public asset downloads, and the old application's update
detection/download/restart. Development mode does not exercise the updater, and old
apps cannot discover a private draft through the public update feed.

After publication, do not replace binaries or move the tag. If a defect is found,
stop further distribution and ship a higher-version compatible fix. Schema v18
cannot be opened by apps supporting only v17. Restoring a pre-migration database is
a separate recovery action and does not retain work performed after the snapshot.
