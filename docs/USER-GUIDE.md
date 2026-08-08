# ShowSlate User Guide

ShowSlate is an offline-first control application for event rundowns, speaker timing, screen content, lower thirds and multiple Program destinations.

## Quick start

1. Open the app and select **New Show**.
2. Enter the show details and paste or import a CSV/TSV rundown.
3. Assign the speaker display, choose a base look and add optional holding content.
4. Use **Identify displays**, then finish the wizard and review **Preflight**.
5. Select a cue in the rundown. Selection prepares the next item; it does not change LIVE.
6. Use **GO NEXT** to make the prepared cue LIVE.
7. Start or pause the timer with **START**. Use the adjustment controls only when required.
8. Confirm Program and all output routes before the event begins.

Nothing should be assumed live merely because it appears in an editor or selected cue. The Program monitor and LIVE status are the source of truth.

## Operator workspace

- **Rundown** contains planned cues. The selected row is NEXT; the LIVE row is the active production cue.
- **Program** shows the state sent to active destinations.
- **START / RESET / adjustments / BLACKOUT** are the primary timer controls.
- **GO NEXT** advances the rundown and updates LIVE atomically.
- **Message** sends text to the speaker output. Quick messages can be edited by double-clicking them.
- **Timer, Look, Lower Third, Network & Outputs** contain detailed settings.
- At narrow window sizes, Rundown, Message and Settings remain available through explicit drawers.

## Output Routing

Open **Network & Outputs**, then **Output Routing**.

1. Add one destination for each required display or window.
2. Give every route a recognizable name such as `Stage Left`, `Confidence` or `OBS Crop`.
3. Choose the physical display.
4. Choose **Fullscreen**, **Window**, **Custom size** or **Grid cell**.
5. For Custom size, enter exact width, height and coordinates.
6. Enable the required routes and select **Apply routing**.

Routes do not silently move to a different monitor if a display disappears. An unavailable or ambiguous route remains blocked until the intended display returns or the operator explicitly changes it.

Use **Stop all** or BLACKOUT when Program must be removed immediately. Re-run display identification after changing adapters, docks or cabling.

## Browser views and remote

The Network panel shows local links and QR codes for:

- screen / browser source;
- phone remote;
- backstage schedule;
- Signal Light;
- API and Companion-style control.

Remote-control and structured API links contain a per-launch token. Treat them as operator credentials. Read-only screen, backstage, Signal Light and legacy event endpoints are visible to devices on the trusted LAN.

For HTTP and OSC commands, see [COMPANION.md](COMPANION.md). For network risks, see [../SECURITY.md](../SECURITY.md).

## Lower thirds

The normal **Lower Third** panel supports speaker name, title, extra line, legacy styles, position, graphic presets and Show/Hide.

Select **Edit Studio** for reusable custom templates:

1. Create or duplicate a template.
2. Add dynamic text for cue fields such as speaker name and title.
3. Add static text, shapes, logos or media.
4. Select a layer to edit position, size, opacity, rotation and media/text properties.
5. Drag layers on the 16:9 canvas or resize them with the visible handles.
6. Select **Save**.
7. Use **Preview** to test locally without changing Program.
8. Use **Take** to resolve the template with data from the LIVE cue and send it to Program.
9. Use **Hide** to remove the lower third and clean up its media.

Export important templates as `.showslate-lt` packages. Imported packages are validated and keep their referenced assets. Legacy `.protimer-lt` packages remain importable.

## Slides and screen content

The **Slides** workspace can prepare images, video, PDF pages, text, logos, timers and blank content.

- Selection changes Preview, not Program.
- **Take** sends the selected content to Program.
- **Clear** removes live screen content.
- Content can be linked to a rundown cue for controlled automatic TAKE on GO.
- Use PDF page controls before taking the item live.

## Saving and recovery

Shows autosave locally using atomic writes and bounded backups. After an unclean shutdown, recovery opens off-air and paused so the operator can inspect state before continuing.

- Export a complete `.showslate-show` package before moving a show to another computer. Legacy `.protimer-show` packages remain importable.
- Import the package into a clean profile and run Preflight.
- Do not rely on autosave as the only backup for a live event.

## Reports

Open **Report** after the show to review planned and actual timing. Export CSV for Excel, Numbers or Google Sheets. The export protects spreadsheet cells from formula execution and preserves Unicode text.

## Languages

English is the default. English and Serbian have full interface coverage. The other 35 language choices cover core operator controls and use English fallback for advanced areas. The selector labels each pack as `FULL` or `CORE`.

## Before every live event

- Connect and power all displays before opening the app.
- Disable sleep, notifications and automatic system updates.
- Prefer wired Ethernet for production browser devices.
- Open the final show package and verify all media.
- Run Preflight with the actual display assignments.
- Test START, GO, BLACKOUT, messages, lower thirds and every output route.
- Keep a fallback timer and a copy of the rundown available.
