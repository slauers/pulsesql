# Releasing Blacktable

This project publishes desktop builds through GitHub Releases.

## Current targets

- Windows
- macOS

Linux is intentionally not part of the release workflow right now.

## Versioning

Keep the version aligned in these files:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

Use semantic versioning:

- `0.1.0` for the first public release
- `0.1.1` for fixes
- `0.2.0` for new features
- `1.0.0` when the app is considered stable

Git tags should use the `v` prefix, for example:

```bash
git tag v0.1.0
```

## Release flow

1. Update the version in the three files above.
2. Commit the version bump.
3. Push the branch.
4. Create and push a tag:

```bash
git tag v0.1.0
git push origin main
git push origin v0.1.0
```

5. Wait for the GitHub Actions workflow to finish.
6. Open the draft release on GitHub.
7. Review the attached artifacts and release notes.
8. Publish the release.

## GitHub Actions behavior

The release workflow is triggered by tags matching:

```text
v*
```

It creates a draft GitHub Release and uploads the generated Windows and macOS bundles.

## Planned package managers

These are not wired up yet:

- `winget`
- `brew`

Recommended order:

1. Publish GitHub Releases first
2. Add `winget`
3. Add Homebrew cask support

## Signing and notarization

Unsigned builds are fine for early releases, but later you will likely want:

- Windows code signing certificate
- Apple Developer signing and notarization for macOS

Those steps require external credentials and are not automated in this repository yet.
