# Releasing PulseSQL

Desktop builds are published through GitHub Releases via GitHub Actions.

## Targets

- macOS (Apple Silicon)
- Windows
- Linux

## Versioning

Keep the version in sync across these three files before tagging:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

Use semantic versioning: `0.1.x` for fixes, `0.x.0` for new features, `1.0.0` when stable.

## Release flow

1. Update the version in the three files above.
2. Commit the version bump.
3. Push the branch and open a PR into `main`.
4. Merge the PR.
5. Create and push a tag from `main`:

```bash
git tag v0.1.x
git push origin v0.1.x
```

6. GitHub Actions builds macOS and Windows bundles and creates a draft release.
7. Open the draft release on GitHub, review the artifacts, and publish.

Once published, users with older versions will see the update notification automatically on next app launch.

## Signing

Binaries are signed with a Tauri minisign keypair.

- The **public key** is stored in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
- The **private key** is stored in the GitHub repository secret `TAURI_SIGNING_PRIVATE_KEY`.

If you need to regenerate the keypair:

```bash
npm run tauri -- signer generate -w pulsesql.key --no-password
```

Update the pubkey in `tauri.conf.json` and the private key in GitHub Secrets before the next release.

## Auto-update endpoint

The updater checks:

```
https://github.com/slauers/pulsesql/releases/latest/download/latest.json
```

This file is generated automatically by the CI when `includeUpdaterJson: true` is set in the workflow. It only becomes accessible after the release is **published** (not while it is a draft).

## Planned distribution

- `winget` — not wired up yet
- Homebrew cask — not wired up yet
