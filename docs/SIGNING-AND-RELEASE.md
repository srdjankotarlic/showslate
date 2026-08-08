# Signing and Release

ShowSlate has separate unsigned public-beta and signed stable-release paths. Beta packages are suitable for evaluation after checksum verification; stable packages require trusted platform signing and hardware QA.

## Current machine state

At the last local check, this Mac had no valid `Developer ID Application` identity and no Apple or Windows signing credentials in the process environment. The Mac QA command therefore applies only a local ad-hoc bundle signature so Electron can enforce embedded ASAR integrity. Ad-hoc signing is not a trusted public signature and cannot be notarized.

Never commit certificates, private keys or passwords. Inject them through the local keychain or protected CI secrets.

## Automated stable release gates

Stable delivery is deliberately split into two manual, fail-closed workflows:

1. `.github/workflows/stable-release.yml` builds a signed candidate and creates a **private draft** GitHub Release. It accepts only an existing `vMAJOR.MINOR.PATCH` tag whose value matches `package.json`, whose commit is on `main`, and whose workflow run is launched from that exact tag ref with confirmation `BUILD`.
2. `.github/workflows/publish-stable.yml` publishes that draft only after a committed `release-evidence/<version>.json` proves physical and external QA against the exact candidate hashes. Its confirmation is `PUBLISH`.

The unsigned beta workflow accepts only `vMAJOR.MINOR.PATCH-beta.NUMBER` tags. A stable tag cannot trigger or publish an unsigned beta artifact.

Configure these protected GitHub Actions secrets before using it:

| Secret | Value |
|---|---|
| `MAC_CERT_P12_BASE64` | Base64-encoded Developer ID Application `.p12`. |
| `MAC_CERT_PASSWORD` | Password protecting that `.p12`. |
| `APPLE_API_KEY_P8_BASE64` | Base64-encoded App Store Connect API `.p8` key. |
| `APPLE_API_KEY_ID` | App Store Connect API key ID. |
| `APPLE_API_ISSUER` | App Store Connect issuer ID. |
| `WINDOWS_CERT_PFX_BASE64` | Base64-encoded exportable Authenticode `.pfx`. |
| `WINDOWS_CERT_PASSWORD` | Password protecting that `.pfx`. |

The candidate workflow decodes credentials only into the ephemeral runner, builds natively on macOS and Windows, and refuses to create a draft unless all of these checks pass:

- package version, exact tag and `main` ancestry;
- deterministic tests and dependency audit;
- Developer ID authority, strict bundle verification, Gatekeeper assessment, notarization ticket and DMG integrity;
- Windows Authenticode status and trusted timestamp on the app, installer and portable executable;
- packaged CLI boot and hardened Electron fuses;
- SHA-256 checksums and GitHub provenance attestations.

Create and push a stable tag only after source readiness gates pass. Then launch the candidate workflow from the exact tag ref:

```bash
gh workflow run stable-release.yml \
  --ref v1.0.0 \
  -f tag=v1.0.0 \
  -f confirmation=BUILD
```

Missing, malformed or invalid credentials stop the run before a draft is created. Download the draft DMG/EXE files and test those exact signed candidates. Copy `release-evidence/example.json` to `release-evidence/1.0.0.json`, fill it only with real retained evidence and the draft checksums, then commit it to `main` without moving the release tag.

After review, run **Publish verified stable release** with the same tag and confirmation `PUBLISH`. That workflow verifies the draft state, candidate run ID and commit, checks every SHA-256, verifies GitHub attestations and validates all required evidence before making the release public. See [stable release evidence](../release-evidence/README.md).

## macOS

Public distribution outside the Mac App Store requires:

1. Apple Developer Program membership and a `Developer ID Application` certificate.
2. Hardened Runtime.
3. Apple notarization credentials.
4. A successful Gatekeeper assessment after notarization and ticket stapling.

Supported electron-builder credential paths:

- signing: `CSC_LINK` + `CSC_KEY_PASSWORD`, or a valid Developer ID identity in the macOS keychain;
- preferred notarization API key: `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`;
- alternative Apple ID flow: `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`;
- alternative keychain profile: `APPLE_KEYCHAIN_PROFILE`, with optional `APPLE_KEYCHAIN`.

The repository includes explicit JIT/unsigned-executable-memory entitlements required by the Electron Hardened Runtime. It does not grant disabled-library-validation or App Sandbox exceptions that the current runtime does not need.

Local ad-hoc signed QA build:

```bash
npm run dist:mac
```

Signed and notarized release build:

```bash
npm run dist:mac:release
```

The release command fails before packaging if signing or notarization inputs are absent. After a successful build, verify the exact artifact:

```bash
codesign --verify --deep --strict --verbose=2 "dist-installers/mac-arm64/ShowSlate.app"
spctl --assess --type execute --verbose=2 "dist-installers/mac-arm64/ShowSlate.app"
xcrun stapler validate "dist-installers/ShowSlate-*-arm64.dmg"
hdiutil verify "dist-installers/ShowSlate-*-arm64.dmg"
```

Also inspect the packaged Electron fuses. `RunAsNode`, Node options and CLI inspect must be disabled; embedded ASAR integrity and OnlyLoadAppFromAsar must be enabled:

```bash
node node_modules/@electron/fuses/dist/bin.js read --app "dist-installers/mac-arm64/ShowSlate.app"
```

## Windows

Public distribution requires an Authenticode code-signing certificate. Provide either:

- `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD`; or
- `CSC_LINK` + `CSC_KEY_PASSWORD` when building only Windows artifacts.

Local unsigned cross-build:

```bash
npm run dist:win
```

Signed release build:

```bash
npm run dist:win:release
```

The final installer and portable executable must be checked on a clean physical Windows x64 machine. Validate signature details in file Properties and with `Get-AuthenticodeSignature`; run installation, first launch, output routing and uninstall before a stable public release.

## Stable release evidence

Do not publish or upload a stable package until all of these are true:

- source and packaged smoke pass on an explicitly selected display, with its exact identity recorded in the retained evidence;
- the artifact is built from a clean, pushed commit;
- checksums and build metadata are recorded;
- macOS signing, notarization, stapling and Gatekeeper assessment pass;
- Windows signing and clean-machine QA pass for Windows packages;
- known limitations and system requirements match the actual artifact;
- an external operator beta has completed without a release-blocking issue.

The publish workflow enforces these manual gates through `release-evidence/<version>.json`. In particular, Mac and Windows records name the exact signed candidate artifact, and the recorded hashes must equal the files in the private draft release. A planned test, placeholder or unchecked item fails validation.

The GitHub Actions beta workflow intentionally publishes unsigned prereleases with SHA-256 checksums and clear operating-system warnings. It does not label those artifacts as signed or production-certified.

Future beta and stable workflows also create GitHub provenance attestations for the binaries. Users can verify a downloaded artifact with:

```bash
gh attestation verify PATH/TO/ARTIFACT -R srdjankotarlic/showslate
```

References: [electron-builder code signing](https://www.electron.build/docs/features/code-signing/), [electron-builder macOS](https://www.electron.build/mac/), [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
