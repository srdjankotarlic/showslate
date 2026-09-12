# Test strategy

## Headless module suite

```bash
npm test
```

Runs 25 deterministic module scripts across brand migration, lower-third packages, show storage and recovery data, portable show packages, Conference Desk schedule/folder import, preflight, screen-content and compositor models, media transport, live-input connection lifecycle, recording lifecycle, control API normalization, OSC packets, HTTP browser dependencies, post-show reports, pure output-routing rules, localization, build provenance, signing preflight and exact-artifact release evidence. Free-build, icon and public-site checks run before that suite. The same command runs in GitHub Actions.

## Local renderer suite

```bash
npm run test:renderers:display
```

Runs the Electron renderer workflows, including hidden output-audio regression checks. Every visible test window resolves the explicitly configured display and aborts if that display is unavailable; it never silently falls back to another screen. Set `SHOWSLATE_SMOKE_DISPLAY` to a unique display label or use the ignored local `.showslate-smoke-display.json` file.

The Conference Desk renderer suite uses visible normal controls to import a fixture folder, finish setup, inspect output-role controls, press GO, verify one Program transaction and require render acknowledgements for Audience, Confidence, Timer, Stream Graphics and Door Agenda. It also checks Live Mode at 900x600.

The public-site renderer suite loads the real static site at desktop and mobile sizes, verifies local screenshots, installer links, horizontal fit and a visible hint of the next section.

## Hidden renderer regression

```bash
npm run test:renderers:hidden
```

Runs 12 real Electron suites: recovery, setup, Conference Desk, screen content, control API, reports, Composer, responsive usability, output audio, mapped output lifecycle, controller reliability and live-input transport. Windows use `show: false` and isolated temporary profiles. It requires a graphical Electron environment but does not open visible windows or use physical capture devices. The audio output test uses a silent synthetic stream and checks standalone audio subscriptions, mute rules, source removal and system-default output selection. Its device-selection assertions stub the OS sink operation; they do not certify a physical speaker or audio interface.

Controller reliability injects full legacy-cache and failed disk-save conditions, tests delayed speaker graphics across cue reordering, verifies safe file restoration and retries saving. Mapped output lifecycle checks canonical-only audio, fade retirement, rapid scene changes, destination geometry, transparency and live placeholders. HTTP dependency tests exercise the production request handler without opening a network socket; OSC tests parse real encoded packets.

The live-input regression uses the real capture hub's synthetic test source and real WebRTC connections to separate Preview and Program consumers. It checks decoded frame progression, muted Preview, one shared capture, independent consumer removal and reconnection without restarting the source. Run it alone with `npm run test:live-input-ui`.

`test:output-audio-ui`, `test:output-lifecycle-ui`, `test:controller-reliability-ui` and `test:live-input-ui` accept `SHOWSLATE_TEST_APP_ROOT` pointing to a built application's `app.asar` to exercise the packaged renderer and preload files using the development Electron runner. This checks archive contents and renderer integration; it is not a full packaged-application smoke run.

Hidden renderer checks complement designated-display smoke; they do not replace visible operator rehearsal, physical output routing or hardware performance measurements. Each suite included in the hidden group accepts `SHOWSLATE_HIDDEN_VISUAL=1` or always keeps its windows hidden. Visible modes retain the configured-display requirement. The public-site visual suite is separate and still requires an explicitly configured safe display.

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
