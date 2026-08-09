# ShowSlate Live Compositor repository map

Current public repository map. Line counts are approximate and should be checked with `wc -l` before line-sensitive work.

## Runtime entry points

| Path | Approx. lines | Risk | Responsibility |
|---|---:|---|---|
| `main.js` | 5,360 | High | Electron main process, HTTP/SSE, OSC, IPC, media storage, output windows and full smoke harness. |
| `controller.html` | 8,530 | High | Operator HTML/CSS/JS, Preview/Program state, rundown, scenes, Lower Third Studio and production workflows. |
| `output.html` | 940 | High | Canonical Program renderer for Electron and browser/OBS output. |
| `preload.js` | 44 | Medium | Context-isolated renderer bridge. Keep the browser fallback in sync. |
| `remote.html` | - | Medium | Phone/tablet remote over HTTP/SSE. |
| `backstage.html` | - | Medium | Schedule and crew view. |
| `signal.html` | - | Medium | Podium signal-light view. |
| `i18n.js` | 390 | Medium | 37 language packs, coverage metadata and remote/backstage/output dictionaries. |

## Product modules

| Directory | Responsibility |
|---|---|
| `src/conference-desk/` | Schedule parsing, show-folder import, media matching, output-role definitions, GO transaction and delivery confirmation contracts. |
| `src/lower-third/` | Versioned template model, validation, migration, runtime resolution, fixture probe and package import/export. |
| `src/show-storage/` | Atomic show repository, recovery, portable show packages and preflight. |
| `src/screen-content/` | Standard screen-content model and validation. |
| `src/control-api/` | Canonical HTTP/OSC command and status normalization. |
| `src/report/` | Canonical post-show report and safe CSV generation. |
| `src/output-routing/` | Pure output config, display resolution and geometry rules. |
| `src/release/` | Stable/beta tag policy, artifact names, checksums and exact-candidate evidence validation. |

## Styling and assets

- `styles/operator-shell.css`: responsive shell and mode layout.
- `styles/pro-ui.css`: shared professional visual system and component styling.
- `build/icon.svg`: source application icon.
- `build/icon.png`, `build/icon.icns`, `build/icon.iconset/`: generated packaging assets.
- `build/banner.html`: repository/social banner source.
- `site/`: static product page, structured data, installer guidance and real product screenshots.
- `examples/conference-show/`: source-user sample CSV and import media.

## Tests

- `tools/run-test-suite.js`: cross-platform aggregate module/renderer runner.
- `npm test`: deterministic free-build/site/icon checks plus sixteen module scripts.
- `test/*-renderer.test.js`: seven real Electron workflow suites pinned to an explicitly selected display.
- `test/conference-desk-renderer.test.js`: visible folder-import, role-routing, atomic GO, render acknowledgement and Live Mode workflow.
- `test/site-renderer.test.js`: desktop/mobile landing-page layout and real-image verification.
- `test/beta-usability-matrix.test.js`: 56 responsive checks at four viewport sizes.
- `main.js --smoke`: source/packaged integration and visual assertions.
- `tools/run-lt-soak.js`: targeted condition-driven soak.
- `test/fixtures/lower-third/`: deterministic image/video/codec fixtures included in packaged smoke.

Generated evidence lives under `artifacts/generated/` and is not release code. `dist-installers/` is ignored build output and must be cleaned before a release build.

## Tooling

| Path | Responsibility |
|---|---|
| `tools/smoke-display.js` | Strict configured-display resolver; absence or ambiguity aborts. |
| `tools/run-smoke-on-display.js` | Source/packaged smoke launcher and focused routing mode. |
| `tools/list-displays.js` | Physical display inventory. |
| `tools/write-build-info.js` | Build commit/timestamp metadata with explicit clean/dirty source state. |
| `tools/assert-release-signing.js` | Fail-closed signing and notarization credential preflight. |
| `tools/check-packaged-free-build.js` | Actual ASAR audit for MIT metadata and forbidden licensing material. |
| `tools/assert-release-tag.js` | Exact package-version and beta/stable tag classifier. |
| `tools/verify-release-evidence.js` | Exact commit/artifact/physical-QA evidence gate for stable publication. |
| `tools/build-social-preview.js` | Deterministic 1600x900 social-preview capture from `build/banner.html`. |

`.github/workflows/stable-release.yml` builds and verifies a signed candidate, then creates a private draft release. `.github/workflows/publish-stable.yml` publishes that draft only after the committed evidence manifest matches its run, commit and artifact hashes.

## Release and product documents

- `README.md`: development and release entry point.
- `ARCHITECTURE.md`: current system boundaries and invariants.
- `docs/TESTING.md`: test layers and commands.
- `docs/CONFERENCE-DESK.md`: show-folder format, output roles, preflight and room-operation workflow.
- `docs/LOCALIZATION.md`: exact language coverage.
- `docs/PUBLIC-BETA-VERIFICATION.md`: verified release evidence and explicit gaps.
- `docs/KNOWN-LIMITATIONS.md`: claims that must remain qualified.
- `docs/COMPANION.md`: control integration.
- `docs/SIGNING-AND-RELEASE.md`: signing secrets, verification commands and stable release gate.
- `docs/RELEASE-READINESS.md`: requirement-by-requirement evidence and current blockers.
- `release-evidence/`: intentionally fail-closed exact-artifact hardware/operator QA records.
- `SECURITY.md`: network and local-control security model.
- `CONTRIBUTING.md`, `SUPPORT.md`: public contribution and support paths.

`dist-installers/`, `node_modules/`, local smoke config and generated artifacts are not source-of-truth product code.
