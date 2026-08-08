# ShowSlate Conference Desk architecture

Current public product architecture.

## Runtime boundaries

- `controller.html` is the operator renderer. `S` is the editable Preview state; `programState` is the state currently sent to Program.
- `send()` sends controller state through the preload bridge. The main process stores `lastState`, forwards Program state to Electron output windows and publishes the same state over SSE.
- `output.html` is the canonical Program renderer for Electron windows and browser/OBS clients.
- `main.js` owns Electron windows, HTTP/SSE, OSC, IPC, media storage, output routing and the full source/packaged smoke harness.

Preview selection must never change the LIVE cue, running timer or Program output until an explicit TAKE/GO/direct action.

## Conference Desk transaction

- `src/conference-desk/model.js` parses CSV/TSV schedules, normalizes output roles, performs conservative media matching and defines the GO/delivery contracts.
- `src/conference-desk/import.js` scans a selected show folder without following symbolic links, applies bounded file/size limits and copies supported assets into private media storage.
- `controller.html` turns imported cues and assets into standard show, scene, content and output records. There is no separate hidden conference document model.
- GO builds one transaction, closes the previous cue, updates LIVE, timer, linked content and immediate lower third, then emits one Program revision. A deliberately delayed lower third can emit a later revision.
- `main.js` stamps each Program revision and route role. `output.html` acknowledges only after the expected role, cue and required lower third are represented in the rendered DOM.
- Preflight uses those acknowledgements to distinguish `SYNCING` from `RENDER CONFIRMED`; an open BrowserWindow alone is not proof of delivery.

## Show data and recovery

- Cues have stable IDs, selected/LIVE separation, planned fields, actual timestamps, status, lower-third automation and optional linked screen content.
- `src/show-storage/repository.js` writes the current show atomically under `userData`, keeps bounded backups and detects an unclean session.
- `src/show-storage/package.js` exports/imports portable `.showslate-show` packages with checksums, schema validation and referenced assets only; legacy `.protimer-show` packages remain importable.
- `src/show-storage/preflight.js` returns blocking/warning/ready checks without changing Program.
- localStorage remains a compatibility/preferences layer; it is not the only show-recovery mechanism.

## Screen content and reports

- `src/screen-content/model.js` validates standard image, video, PDF, text, logo, timer and blank items.
- Scenes and layers remain in `S.scenes`; a timer layer controls `#stage` inside the Program renderer.
- `src/report/model.js` builds the post-show report from canonical cue actual fields, with legacy log fallback and spreadsheet-safe CSV output.

Window capture is intentionally absent. ShowSlate is a rundown, timing, graphics and display-distribution product, not an OBS/Resolume replacement.

## Lower thirds

- `src/lower-third/model.js`, `validate.js`, `migrate.js` and `resolve.js` define the versioned template/runtime contract.
- `src/lower-third/package.js` imports/exports `.showslate-lt` packages and their referenced media; legacy `.protimer-lt` packages remain importable.
- Lower Third Studio edits templates locally. PREVIEW resolves selected-cue data without touching Program; TAKE resolves the active template with LIVE cue data.
- `output.html` renders resolved runtime layers and retains the legacy lower-third renderer as a compatibility fallback.
- MP4/H.264, WebM VP8 and WebM VP9 fixture decode/compositing are covered by smoke. Claims remain limited to the exact tested environment and fixtures.

## Output routing

- `src/output-routing/model.js` contains pure normalization, display identity, fail-safe resolution and pixel/grid bounds rules.
- `main.js` owns `outputConfigs` and the `auxOutputs` BrowserWindow map.
- Each enabled route receives the same Program state and can use fullscreen, normal window, pixel-accurate custom or grid-cell placement.
- Routes have explicit Audience, Confidence, Timer, Stream Graphics or Door Agenda roles. Role rendering is a view of canonical Program state, not an independent timeline.
- Stream Graphics windows are transparent and hide room content; Confidence, Timer and Door roles suppress unrelated Program layers.
- Display IDs are paired with a stable label/size fingerprint. A missing or ambiguous display is reported as unavailable and never silently replaced by another monitor.
- Display add/remove/metrics events reconcile routes. Custom routes are frameless so macOS cannot cascade or clamp requested pixel coordinates.

## Network control

- HTTP/SSE server: output page, remote, backstage, signal, authenticated command/status endpoints and ranged media delivery.
- OSC UDP uses the same canonical command normalization as HTTP.
- `src/control-api/commands.js` sanitizes commands and bounded status payloads.
- Security limitations, including unauthenticated local OSC, are documented in `SECURITY.md`.

## Localization

- English is the default.
- English and Serbian are `FULL` product dictionaries.
- 35 additional `CORE` packs localize primary workflows and use English fallback for advanced strings.
- Arabic, Urdu and Persian set RTL document direction.
- Exact scope is documented in `docs/LOCALIZATION.md`.

## Verification and release

- `npm test`: fifteen deterministic headless module scripts plus repository/site/icon contracts.
- `npm run test:renderers:display`: seven real renderer workflows pinned to an explicitly selected display, including Conference Desk and public-site viewports.
- `npm run test:beta-ui`: responsive product matrix.
- `npm run smoke:display`: full source smoke.
- `npm run smoke:packaged:display`: full packaged smoke.
- `npm run smoke:lt-soak`: condition-driven lower-third soak.

Local visual regression is pinned to an explicitly configured display and aborts when that display is unavailable or ambiguous. Stable Mac distribution still requires Developer ID signing and notarization; stable Windows distribution still requires real Windows x64 QA and signing.

## Non-negotiable compatibility rules

- Do not use `window.prompt()`; use the application modal.
- Do not reintroduce window capture without a new approved product scope.
- Do not change timer, GO, Program state or output protocols as part of unrelated work.
- Do not remove the legacy lower-third renderer while legacy shows remain supported.
- Any new preload method also needs a browser fallback in `controller.html`.
