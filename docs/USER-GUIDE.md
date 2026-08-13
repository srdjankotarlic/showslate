# ShowSlate Live Compositor User Guide

ShowSlate is a local-first live compositor and show-control application. Its Composer builds layered scenes for Preview and Program; the included Conference Desk workflow keeps a rundown, speaker timing, linked content, lower thirds and role-based outputs on the same LIVE cue.

## Quick start

1. Open the app and select **Import Show Folder** or **New Show**.
2. Import a folder containing CSV/TSV plus media, paste spreadsheet rows, or select a schedule file.
3. Review recognized cues, skipped rows and linked media.
4. Assign the Audience display, choose a base look and create the show.
5. Open **Outputs** to add Confidence, Timer, Stream Graphics or Door Agenda routes.
6. Run **Preflight**, select **Test outputs** and resolve every blocking check.
7. Select a rundown row to prepare NEXT. Selection never changes LIVE.
8. Enter **Live Mode**, then press **GO**.

GO updates the LIVE cue, timer, linked screen content and immediate automatic lower third in one Program revision. Every active output receives that same revision. Delayed lower thirds are sent later by design.

Use **Load conference demo** in an empty workspace to practice without preparing files. The demo remains off external displays until routing is applied or tested.

## Operator workspace

- **Rundown** contains planned cues. The selected row is NEXT; the green row is LIVE.
- **Slides** contains imported and manually created screen content.
- **Program** is the state sent to active destinations and is the operator's source of truth.
- **START / PAUSE, RESET, adjustments and BLACKOUT** control the live timer state.
- **GO NEXT** advances the rundown and applies the cue transaction.
- **Message** sends urgent text to Confidence and Timer outputs.
- **Live Mode** disables show import and rundown editing while keeping GO and live controls available.
- **Outputs** opens the explicit destination manager.
- Sidebars and settings remain reachable through visible header controls at narrow window sizes.

## Show-folder import

The importer scans one selected folder, chooses a CSV/TSV schedule, manages smaller media in ShowSlate storage and links large originals at their current disk path. A cue links to media by an exact `media` filename/path or an exact normalized cue title.

Excel workbooks are not parsed directly. Export the rundown sheet as CSV/TSV or paste its rows into the wizard. See [CONFERENCE-DESK.md](CONFERENCE-DESK.md) for the folder layout, supported columns, media types and safety limits.

## Output Routing

Select **Outputs** from the header.

1. Add one destination for each required room or production view.
2. Give each route a recognizable name.
3. Choose its role and exact physical display.
4. Choose **Fullscreen**, **Window**, **Custom size** or **Grid cell**.
5. Choose a standard or custom output Canvas resolution and frame rate for that destination, then choose **Fit**, **Cover** or **Fill** scaling.
6. For Custom size, enter width, height and coordinates.
7. For a projector or LED processor, select **Map projector** and follow the mapping workflow below.
8. Enable **Program audio** on no more than one local desktop route when a scene really needs source audio.
9. Enable the route and select **Apply routing**.

Available roles:

- **Audience** shows linked media, holding screens, timers and full Program content.
- **Confidence** shows current cue, next cue, speaker details, timer and messages.
- **Timer** shows a clean speaker timer and urgent messages.
- **Stream Graphics** shows transparent lower thirds and graphics for capture testing.
- **Door Agenda** shows room, current session, next session and clock.

Routes do not silently move to a different monitor if a display disappears. An unavailable or ambiguous route remains blocked until the intended display returns or the operator explicitly changes it.

Every enabled route receives the same Program revision but keeps its own Canvas, scaling and optional projector mapping. Mapping transforms the complete Program, including scene layers, timer, text, logos and lower thirds.

### Projector mapping workflow

1. Open **Outputs**, create and configure the physical destination, then select **Map projector**. The same editor is available from **Composition** in the main header.
2. Select the required composition and use its native Canvas dimensions. Custom Canvas sizes are intended for exact LED-processor pixel spaces.
3. Select **Add surface**. Name the surface and assign it to an output destination. Multiple surfaces may target the same destination.
4. In **Input Selection**, drag/resize the surface or enter exact pixel values to choose the source region. Horizontal and vertical flip are available for unusual optical paths.
5. In **Output Mapping**, place the surface in the destination, set its size/rotation and choose **Perspective** for four-corner correction or **Linear mesh** for curved or segmented geometry. Meshes are bounded to 4 x 4 cells in this beta.
6. Drag corner, mesh or enabled polygon-mask points directly on the canvas. A surface can be hidden or Soloed while calibrating.
7. Turn on Grid, Checker or Crosshair and optional surface labels. Adjust edge overlap, blend gamma and black level for adjacent projectors.
8. Duplicate a surface when building a neighboring projector, then adjust its Input Selection and Output Mapping independently.
9. Select **Save**, then **Apply mapping to outputs**. Turn calibration patterns off and inspect every physical edge before doors open.

Mapping data is saved with the show. The beta does not perform automatic camera calibration, projector color matching or physical venue certification.

## Preflight

Preflight checks the saved show, rundown, media, output assignments, cue actions, local services and recovery state. Conference shows also require an Audience route.

**Test outputs** applies the configured routes and waits for each renderer to acknowledge the current Program revision. The status is **SYNCING** until the correct state is visible, then changes to **RENDER CONFIRMED**.

Warnings do not always block entry to the workspace, but the operator must understand them. Never infer that an external display is correct from the controller preview alone.

## Running cues

- Single-click a row to make it NEXT.
- Press GO to make NEXT become LIVE.
- The cue duration replaces the current countdown and starts automatically when **Auto-start on GO** is enabled.
- Linked media is taken with the cue when **Auto TAKE content on GO** is enabled.
- Speaker data resolves into the active lower-third template when automatic lower thirds are enabled for that cue.
- The previous cue receives actual end and duration data for the post-show report.

The Live strip always shows LIVE and NEXT together. **NEXT ROW** advances strictly in rundown order; the main GO control can also take an explicitly selected row.

## Canvas and scene composition

Select **Composer** in the visible header to open the scene compositor. This workspace stays available at narrow window sizes and keeps the scene selector, scene actions, Add Source, layer list and inspector reachable by scrolling.

1. Open **Composer**, then select an existing scene or create, duplicate or delete one from its header.
2. Choose a standard preset or enter a custom width, height and frame rate.
3. Select **Add Source** and add a picture/video/PDF, solid color, text, timer, application window/display or video capture device.
4. For a camera or UVC capture card, choose **Allow camera** when access is first needed. Choose **Allow audio** separately only when that source should carry sound, then select the devices, resolution and frame rate. If macOS access was denied earlier, use the visible settings shortcut, enable ShowSlate in the matching Privacy section and restart the app.
5. Arrange the stack in **Layers**. The top row is visually in front.
6. Select a layer, then drag it in Preview or use the inspector for exact position, size, opacity, rotation and fit.
7. Use **Change source** to reconnect a window or device without losing that layer's transform.
8. Keep **Direct Program** off while preparing. Select **TAKE** to send the complete Preview scene to Program.

ShowSlate keeps original picture/video bytes and does not reduce their quality. Files over 512 MB are linked and streamed from disk rather than copied or loaded wholly into RAM. Keep the source drive connected and do not move or rename linked files. For multi-gigabyte playback, use a fast SSD and test the exact codec, resolution, frame rate and number of active outputs before the event.

Preview capture is always muted. To hear audio from an enabled video/capture layer, enable **Program audio** on exactly one local desktop output. It is off by default to prevent feedback.

Window, display and capture-device streams are local to the desktop app. They appear in ShowSlate desktop output windows, but not in the browser/OBS URL output. Device identifiers can change after moving a show to another computer, so use **Change source** and run Preflight again.

If Preflight warns about a Canvas/output aspect mismatch, the scene can be stretched by that destination. Either match the Canvas to the destination or confirm that the non-matching format is intentional.

## Speaker timing and messages

Open **Settings > Timing** when a scene needs countdown, stopwatch or clock controls. The timer remains available as a scene source and supports warning colors, overtime, progress, chimes and scheduled start without occupying the permanent live workspace.

Use Message for urgent presenter communication. Confidence and Timer roles display the message prominently. Quick messages can be edited by double-clicking them.

## Lower thirds

The normal **Lower Third** panel provides fast name, title, extra line, position, graphic and Take/Hide controls.

Select **Edit Studio** for reusable custom templates:

1. Create or duplicate a template.
2. Add dynamic cue fields such as speaker name, title, company or session.
3. Add static text, shapes, logos or media.
4. Select a layer to edit position, size, opacity, rotation and media/text properties.
5. Drag layers on the 16:9 canvas or resize with the visible handles.
6. Select **Save**.
7. Use **Preview** to test locally without changing Program.
8. Use **Take** to resolve the template with data from the LIVE cue.
9. Use **Hide** to remove the lower third and clean up its media.

Export important templates as `.showslate-lt` packages. Legacy `.protimer-lt` packages remain importable. Portable packages embed assets up to 200 MB each; a template using larger disk-linked media must travel with those original files instead.

## Slides and linked content

The **Slides** workspace supports images, video, PDF pages, holding text, logos, timers and blank content.

- Selection changes Preview, not Program.
- **Take** sends the selected item to Program.
- **Clear** removes live screen content.
- Imported media can be linked to a cue for automatic TAKE on GO.
- Use PDF page controls before taking the item live.

## Local browser views and control

The Network panel provides local URLs and QR codes for browser output, phone remote, backstage schedule, Signal Light and authenticated API control.

Remote and API links contain a per-launch token. Treat them as operator credentials. Use a trusted production LAN and do not expose local ports directly to the public internet. See [COMPANION.md](COMPANION.md) and [../SECURITY.md](../SECURITY.md).

## Saving, recovery and reports

Shows autosave using atomic writes and bounded backups. After an unclean shutdown, recovery opens paused and off-air so the operator can inspect state before continuing.

- Export a `.showslate-show` package before moving a show to another computer. The package embeds managed assets up to 200 MB each; disk-linked media must be copied separately and reselected on the destination computer.
- Import it into a clean profile and run Preflight with the actual display chain.
- Do not rely on autosave as the only live-event backup.
- After the show, open **Report** and export planned versus actual timing as CSV.

## Languages

English is the default. English and Serbian have full interface coverage. The other 35 language choices cover core operator controls and use English fallback for advanced areas. The selector labels each pack as `FULL` or `CORE`.

## Before doors open

- Connect and power all displays before opening ShowSlate.
- Grant Screen Recording only when using window/display capture. ShowSlate requests Camera and audio-input access separately from visible buttons in the capture-device picker; enable only what the show needs.
- Disable sleep, notifications and automatic system updates.
- Prefer wired Ethernet for browser devices.
- Open the final show and verify every media asset.
- Identify displays, apply routing and run Preflight.
- Test GO, START, BLACKOUT, messages, lower thirds and every output role.
- Test every live window/device source, Program-audio route and stream-capture path separately when used.
- Keep a fallback timer and a copy of the rundown available.
