# Public Beta Verification

Local verification through 2026-09-12 supports the `0.12.0-beta.5` update. This page separates hidden-window regression checks from historical visible Mac workflows and from exact tagged release artifacts. It does not certify physical Windows or venue hardware behavior.

## 2026-09-12 Live Deck verification

The Live Deck source at clean commit `3f0cbef4614c40f98fd8401830df3fcda3933967` passed 26 module groups, the free-build/icon/site contracts, and 13 hidden Electron groups with 265 checks. The dedicated Live Deck suite contributes 29 checks covering actual image/H.264/VP8 thumbnail decoding, missing-media fallback, responsive bounds, Preview/Program isolation, one-row replacement, PIN continuity, duplicate source IDs, transport pairing, lower-third runtime and native keyboard events. The thumbnail helper has 20 deterministic checks for bounded decoding, cancellation, stale work and capture-free live snapshots.

A clean local Apple Silicon candidate (`0.12.0-beta.4-live.1`) built from that commit passed 29 Live Deck and 10 controller-reliability checks against its packaged ASAR using Electron 43.1.1, plus executable build-info boot, byte-for-byte runtime matching, strict ad-hoc signature, DMG integrity and MIT/no-activation checks. The dependency audit reported zero vulnerabilities. Screenshots at [1440×900](images/live-deck-1440x900.png), [1024×700](images/live-deck-1024x700.png), and [900×600](images/live-deck-900x600.png) show a fixture show, not a customer's media or physical capture devices.

Those local checks precede the beta 5 version/release metadata commit. The native beta workflow separately rebuilds the tagged Mac and Windows downloads, checks boot/provenance and creates checksums/attestations. Local candidate tests are not an exact-artifact physical rehearsal of those downloads. No physical Windows, HDMI/LED/UVC, external audio device or sustained 4K60 certification is added by this update.

## 2026-09-12 reliability verification

The local reliability candidate included the source changes now prepared for beta 4. Before the release version and commit were finalized, it passed:

- `npm test`: 25 module groups and 262 reported checks, plus free-build, icon and public-site checks.
- `npm run test:renderers:hidden`: 12 Electron groups and 236 checks covering recovery, setup, Conference Desk, screen content, control status, reports, Composer, responsive usability, audio, mapped-output lifecycle, controller failures and synthetic WebRTC transport.
- A fresh local Apple Silicon build: 40 repeated output-audio, output-lifecycle, controller-reliability and live-input checks against its packaged `app.asar`, using development Electron 43.1.1.
- Byte-for-byte comparison of all 15 changed runtime files against the packaged archive, packaged CLI boot with an isolated profile, MIT/no-activation-gate inspection, strict/deep local signature verification and DMG integrity verification.
- Dependency audit with zero reported vulnerabilities, diff whitespace checks and changed JavaScript/inline-script syntax checks.

These tests covered full legacy-cache handling during GO and show loads, delayed lower thirds after cue reordering, autosave error reporting, recording failures, recovery across repeated crashes, live-input connection cleanup, mapped audio/transitions, count-up/report timing, OSC booleans, browser-output dependencies and portable media packages.

The local artifact still identified the beta 3 base commit plus uncommitted changes; it is not an exact beta 4 release artifact. Tagged release packages must be rebuilt from the clean beta 4 commit through the [native beta workflow](https://github.com/srdjankotarlic/showslate/actions/workflows/release.yml), which checks packaged boot/provenance and creates checksums and attestations before publication. Local regression totals must not be treated as an exact-artifact physical rehearsal of those CI downloads.

The September 12 renderer tests used hidden windows, isolated temporary profiles, synthetic media and mocked device operations. No customer shows, capture devices or installed application profile were used. The packaged renderer checks are not a full visible packaged-app rehearsal. This run adds no physical HDMI/LED/UVC, Windows, external audio-sink or sustained 4K60 certification. The older visible display and recording evidence below remains historical evidence only.

## 2026-08-25 operator recovery verification

The beta 3 source was operated through the visible packaged interface and then checked with the full automated Mac suite on `Built-in Retina Display`. The review found and corrected several first-run and recovery problems:

- New Show, Import Show Folder and Preflight are now visible in the Show menu instead of being hidden in the overflow menu.
- A new show on the control display now starts with a safe 16:9 window route rather than taking the operator display fullscreen. The initial window is bounded to 80% of the display and capped at 1280x720.
- New shows select a neutral `Starter Template` lower third instead of inheriting a development or QA template.
- Preflight reports the lower-third template by its readable name instead of exposing an internal identifier.
- Output Routing opens at the first destination, while its fixed footer and deeper Canvas controls remain reachable through local scrolling.
- Scene rename, rundown reorder/skip/delete controls, planned start time and the Settings close control now expose localized titles and accessibility labels.

The current source run passed all module suites, all eight renderer suites, `69/69` Composer checks, the `56/56` responsive usability matrix and the complete display smoke with `SMOKE_OK`. Full-HD synthetic live-input transport also passed its target. A separate synthetic 3840x2160/60 run reached roughly 48-52 rendered fps depending on codec and did not meet the 55 fps certification threshold; 4K60 live capture is therefore explicitly not certified.

This run used only the Built-in Retina Display. It did not physically validate HDMI reconnect ordering, an external projector/LED processor, a UVC capture card or Windows hardware. Those remain off-air test requirements, not release claims.

## 2026-08-16 Program recording verification

The full source display smoke and a freshly packaged Apple Silicon application smoke both completed with `SMOKE_OK` on the explicitly selected `HP E24u G5` display. Recording model checks passed `5/5`, the Composer renderer checks passed `68/68` and all eight renderer suites passed.

A normal packaged-app workflow was then operated through the visible interface: the test video was connected to a scene, enabled for Program audio, taken to Program, recorded from the main **Record Program** control and stopped from the same control. The resulting 37.9-second MP4 was inspected independently with FFprobe/FFmpeg:

- H.264 video at 1920x1080 and approximately 29 fps;
- AAC stereo audio at 48 kHz;
- measured audio at approximately -21.1 dB mean and -17.6 dB peak;
- an extracted frame contained the exact clean Program test pattern rather than Preview or the operator interface.

This proves one complete MP4/H.264 plus AAC recording path on the tested Apple Silicon Mac. It does not certify every codec, Windows encoder, long-duration recording, 4K/60 workload, destination drive or failure-recovery condition.

## 2026-08-13 advanced mapping development verification

Targeted source renderer/model checks and a freshly packaged Apple Silicon smoke run exercised the in-development multi-surface mapping workflow on `Built-in Retina Display`.

- A custom 5376x768 composition was split into two independent Input Selection regions and mapped to separate halves of one 1920x1080 destination.
- The first surface used four-corner perspective correction. The second used a 2x2 linear mesh with a polygon mask.
- The route payload retained both surfaces, and the output renderer produced one perspective frame plus four independently transformed mesh cells.
- Grid and Checker calibration patterns, surface labels, edge overlap and dynamic Program content remained present after mapping.
- The editor remained reachable at 900x600 through local scrolling.
- The packaged app retained strict display selection, fullscreen restore, simultaneous independent outputs, custom Canvas settings and mapped complete-Program rendering.

This is development evidence, not a new public release certification. No physical multi-projector overlap, venue surface, lens, brightness or color-matching pass was performed for this update.

## 2026-08-11 multi-output mapping update

Targeted source and freshly packaged Apple Silicon checks passed on the explicitly selected `PHL 243V7` display from clean commit `11489f9c3dcbb21cdf8dd90d4beb70704f81e27d`.

- Two output windows received and acknowledged the same Program revision simultaneously.
- The first route used a 1920x1080 Canvas with Fit scaling, four-corner projector warp and a visible 8x6 calibration grid.
- The second route independently used a 1000x1000 Canvas with Cover scaling and no projector warp.
- Both routes reached the real `live` acknowledgement state; the check does not pass on merely open or still-syncing windows.
- Missing-display and exact-display reconnection behavior remained fail-closed.

This proves ShowSlate's per-route configuration, full-Program renderer transform and delivery acknowledgement on the tested Mac. It does not certify alignment, brightness, focus, lens geometry, processor behavior or color on every physical projector or LED installation.

## Physical Mac verification

The `0.12.0-beta.2` complete source smoke and fresh packaged Apple Silicon `.app` smoke both passed on the explicitly selected `HP E24u G5`. Earlier release evidence on this page also covers the `Built-in Retina Display` and `PHL 243V7`. The beta 3 source verification above used the Built-in Retina Display. The test resolver fails closed if the configured display is missing or ambiguous and does not silently fall back to another monitor.

The verified Conference Desk workflow includes:

- visible show-folder import with CSV/TSV schedule parsing and safe media matching;
- an off-air setup result with linked cues, copied assets and an Audience route;
- preflight checks for the show, mapped media, output roles and actual render acknowledgements;
- one atomic GO revision for LIVE cue, timer, linked content and automatic lower third;
- Audience, Confidence, Timer, Stream Graphics and Door Agenda output roles;
- multiple simultaneous fullscreen, window, custom-size and grid routes;
- exact-display reconnection and safe handling of missing displays;
- Live Mode with risky editing locked and GO reachable at 900x600;
- images, logos, PDF navigation, MP4/WebM playback, scenes and linked screen content;
- custom-resolution Canvas scenes with ordered color, picture, video, text and timer layers;
- visible scene controls, layer selection, drag/resize handles, exact transform controls and Preview/TAKE isolation;
- non-native display-fill fullscreen routes that cover the selected display without creating a separate macOS Space;
- Lower Third Studio persistence, drag/resize, selected-cue Preview isolation, LIVE-cue TAKE and HIDE media cleanup;
- PNG/JPG/SVG, MP4, WebM VP8 and WebM VP9 renderer fixtures, including internal alpha-pixel checks;
- local network views, remote/API controls, reports, CSV export, localization, autosave, crash recovery and portable show packages.

Both full smoke runs ended with `SMOKE_OK`: one from source and one from the freshly packaged Apple Silicon `.app`. A targeted lower-third soak completed 150/150 cycles with the expected template, instance, cue and rendered text on every cycle; no first failure was recorded.

The live-input service also passed its targeted synthetic-stream test. A hidden capture hub produced one 1280x720/30 fps video track and one audio track, distributed the stream to Preview and desktop Program consumers over local WebRTC, kept Preview muted and stopped/reconnected cleanly. This proves the internal transport and lifecycle, not compatibility with every physical capture device.

## Automated evidence

- The full module test command passed together with free-build, icon and public-site checks.
- Visible Electron renderer suite: all eight workflow scripts passed.
- Conference Desk renderer: `13/13` checks passed.
- Canvas/compositor renderer: `68/68` checks passed, including recording UI, 900x600 reachability, layer order, hidden-source retention, visible privacy-settings recovery actions, transform persistence and Preview/TAKE isolation.
- Targeted live-input and multi-output checks passed, including simultaneous Program routes, fail-closed missing-display handling and the one-Program-audio-route guard.
- Responsive beta usability matrix: `56/56` checks passed at 1440x900, 1280x800, 1024x700 and 900x600.
- Public website renderer: `7/7` desktop/mobile checks passed with no horizontal overflow and all local product images loaded.
- Production dependency audit: zero known vulnerabilities.
- Mac and Windows packaged-content checks: `PACKAGED_FREE_BUILD_OK`, 1,449 archive entries each, MIT package and no activation/private-key files.
- Mac DMG checksum verification: valid.
- Untagged native release rehearsal [GitHub Actions run 31308928626](https://github.com/srdjankotarlic/showslate/actions/runs/31308928626): macOS and Windows jobs both passed from exact clean commit `09f4e7d6c007e364355ade270a092ed11937cca0`; the Windows runner successfully booted the packaged EXE in CLI verification mode. The run produced the Mac DMG, Windows installer and Windows portable artifacts, then correctly skipped publication because no release tag existed.

Release builds record the exact full commit and dirty state. Tagged GitHub builds generate SHA-256 checksums and provenance attestations.

The compositor beta is published as an experimental prerelease after automated checks and native Mac/Windows package builds. Physical window/display capture, UVC capture-card video/audio and Windows GUI evidence are not publication requirements for this beta and are not claimed as proven. The optional record in `release-evidence/beta` remains incomplete.

## Platform truth

### Proven on physical hardware

- Apple Silicon macOS application on the tested Built-in Retina, PHL 243V7 and HP E24u G5 display configurations.
- Source and packaged output routing, custom Canvas/layer composition, local network renderer and lower-third/media workflows.
- Packaged local Program recording to MP4/H.264 with AAC audio on the tested Mac.

### Built natively and structurally inspected, not physically certified

- Windows 10/11 x64 NSIS installer and portable package.
- Their PE format and packaged contents were inspected locally, and the native Windows workflow completed package construction plus packaged CLI boot. A clean physical-machine GUI test is still required.

### Still not proven

- Developer ID signing/notarization and Windows Authenticode signing.
- Clean physical Windows install, firewall, multi-display, portable and uninstall workflows.
- Intel Mac support.
- A manual normal-UI run reached the real window/display source picker on 2026-08-09, but macOS Screen Recording access was disabled. The blocked state and its direct System Settings action are verified; a real captured frame is still not claimed until access is enabled and the app is restarted.
- Physical camera or UVC capture-card compatibility, including device audio, drivers, source formats and HDCP behavior.
- External OBS/vMix video-alpha integration. Internal Electron alpha compositing is proven, but that does not certify another application's browser/media pipeline.
- Windows Program recording, long-duration recording, redundant recording and sustained 4K/60 capture.
- NDI, camera switching, live-stream encoding, multibus audio mixing or cloud collaboration.
- Independent operator adoption or production certification.

Window/display and device capture are local to ShowSlate and its desktop output windows. They are not sent through the browser/OBS URL. Preview is always muted, and only one local Program destination can carry live-input audio at a time.

These gaps are why the release is labelled **public beta**. Test the exact show computer, display chain, network and final media before using it on-air.
