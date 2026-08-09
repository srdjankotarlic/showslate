# Test strategy

## Headless module suite

```bash
npm test
```

Runs 16 deterministic module scripts across brand migration, lower-third packages, show storage and recovery data, portable show packages, Conference Desk schedule/folder import, preflight, screen-content and compositor models, control API normalization, post-show reports, pure output-routing rules, localization, build provenance, signing preflight and exact-artifact release evidence. Free-build, icon and public-site checks run before that suite. The same command runs in GitHub Actions.

## Local renderer suite

```bash
npm run test:renderers:display
```

Runs eight real Electron renderer workflows. Every visible test window resolves the explicitly configured display and aborts if that display is unavailable; it never silently falls back to another screen. Set `SHOWSLATE_SMOKE_DISPLAY` to a unique display label or use the ignored local `.showslate-smoke-display.json` file.

The Conference Desk renderer suite uses visible normal controls to import a fixture folder, finish setup, inspect output-role controls, press GO, verify one Program transaction and require render acknowledgements for Audience, Confidence, Timer, Stream Graphics and Door Agenda. It also checks Live Mode at 900x600.

The public-site renderer suite loads the real static site at desktop and mobile sizes, verifies local screenshots, installer links, horizontal fit and a visible hint of the next section.

## Responsive product matrix

```bash
npm run test:beta-ui
```

Checks the real operator workspace at 1440x900, 1280x800, 1024x700 and 900x600. It covers Standard, Compact, Advanced, panels, Output Routing, Lower Third Studio, wizard, preflight, slides, recovery and report workflows. Current expected result: 56/56.

## Full source and packaged smoke

```bash
npm run smoke:display -- --display "Built-in Retina Display"
npm run dist:mac
npm run smoke:packaged:display -- --display "Built-in Retina Display"
```

Replace the example label with the exact unique label of the screen selected for the run. The source and packaged smoke suites cover Program state, timer/GO invariants, media/codecs, localization, simultaneous output routes, Lower Third runtime/editor behavior and responsive UI. They abort before opening the application when the requested display is missing or ambiguous; there is no automatic fallback to another screen.

Focused routing verification is available as:

```bash
npm run smoke:output-routing -- --display "Built-in Retina Display"
```

Focused live-input transport verification is available as:

```bash
npm run smoke:live-input -- --display "Built-in Retina Display"
```

It proves that one synthetic video-and-audio source is acquired once, advances in muted Preview, leaves Program unchanged before TAKE, then advances in the exact Program scene after TAKE. It does not certify a physical capture card or operating-system permission workflow.

## Soak

```bash
npm run smoke:lt-soak
```

The soak waits for the expected runtime instance and stable rendered DOM. It does not pass based on a fixed sleep or merely visible container.

## Release evidence

Passing automated checks do not replace signing, notarization or Windows hardware QA. See [PUBLIC-BETA-VERIFICATION.md](PUBLIC-BETA-VERIFICATION.md) and [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md).

The manual **Build signed stable candidate** workflow is intentionally unusable without real protected signing secrets. It validates an exact stable tag, runs the headless suite, signs on native platform runners, verifies notarization or Authenticode timestamps, attests the binaries and creates a private draft release.

The separate **Publish verified stable release** workflow remains blocked until `release-evidence/<version>.json` binds that exact candidate's hashes to designated-display smoke, physical Mac/Windows installation, external operator beta and release-document review. See [release evidence](../release-evidence/README.md).

Both beta and stable package jobs run `npm run check:packaged-free -- PATH/TO/app.asar` against the actual Mac and Windows archive, rather than inferring packaged contents from the source tree.
