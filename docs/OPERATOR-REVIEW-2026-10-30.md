# Operator workflow review — 2026-10-30

Reviewed the existing beta 6 source and operated an isolated native controller through the macOS interface: add a text source, confirm its content, TAKE/HIDE the layer, enter Live Mode, TAKE CLIP, exit Live Mode, create a 30-second rundown item and GO. Preview, Program and LIVE status changed as expected. The test used a disposable profile and no operator media. Only the built-in Retina display was connected; no external output or device certification was performed.

Three reproduced playback problems were corrected:

- Adding a caption during CUT playback discarded the Program decoder. A real H.264 fixture jumped from approximately 0.22 seconds to zero. Immediate updates now reuse matching layer ID and media URL, while source replacement releases the old decoder. Fading frames retain their separate media and retirement behavior.
- The 35 ms seek tolerance ignored a single 60 fps frame step. The tolerance is now below one millisecond.
- Trimmed playback could end 35 ms before OUT. The boundary check now uses a 1 ms tolerance, with existing decoded-frame callbacks and time-update fallback.

Focused regressions cover continuity with actual decoded video, cleanup after source replacement, one-frame seeking and playback immediately before OUT. Existing module and hidden renderer suites cover storage/recovery, import/export, cues/GO, lower thirds, composition, live deck, synthetic live inputs, audio routing, recording controller and mapped output lifecycle. Their checks do not establish every possible hardware/media combination.

Compatible dependency updates address the npm advisories found during this review. Electron is updated within its existing major version to 43.8.4, whose upstream notes are at https://releases.electronjs.org/release/v43.8.4. Historical release evidence remains unchanged.
