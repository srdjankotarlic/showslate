**Comparison Target**

- Source visual truth: `/Users/srdjankotarlic/Desktop/Screenshot 2026-08-11 at 12.23.00.png`.
- Rendered implementation: `/Users/srdjankotarlic/Documents/New project/protimer-studio-release/artifacts/generated/screen-content/scenes-1280x800.png`.
- Combined comparison: `/Users/srdjankotarlic/Documents/New project/protimer-studio-release/artifacts/generated/screen-content/monitor-header-comparison.png`.
- Viewport: 1280 x 768 CSS px, device scale factor 1.
- Source pixels: 972 x 36. Implementation pixels: 1280 x 768. The comparison uses the matching 36 px monitor-top region from both states and scales both equally for inspection.
- State: Scenes view open, a scene selected in Preview, another scene live in Program, Composer workspace open.

**Full-View Comparison Evidence**

- Preview and Program now form two equal-width, edge-to-edge monitor regions with no title/status bar above either canvas.
- The single live-control surface is anchored at the bottom of the left sidebar and remains separate from the visual monitoring area.
- The Composer inspector remains below the monitor wall and does not overlap either monitor or the live controls.

**Focused Region Comparison Evidence**

- The source crop shows the 34 px PREVIEW/PROGRAM title bars and their READY, SCREEN CLOSED, and BLACK chips.
- The combined comparison shows those bars removed and the scene canvas beginning at the monitor's top edge.
- Preview and Program retain their blue/green border semantics without consuming canvas height with repeated labels.

**Findings**

- No actionable P0, P1, or P2 visual mismatch remains for the requested monitor-header removal.
- Fonts and typography: existing ShowSlate system typography, weights, line heights, and letter spacing remain consistent; no new wrapping or clipping is visible.
- Spacing and layout rhythm: the full monitor height is now available to each 16:9 canvas; there is no empty title strip above either picture.
- Colors and visual tokens: TAKE, GO NEXT, BACK, and BLACK retain the existing blue, green, neutral, and danger semantics.
- Image quality and assets: no image asset was added or altered; Preview and Program remain sharp at their larger rendered size.
- Copy and content: redundant monitor labels and status chips are removed; operational status remains available through Outputs and the BLACK control state.

**Open Questions**

- None for this scoped change.

**Implementation Checklist**

- [x] Remove the switcher column between Preview and Program.
- [x] Keep one TAKE control.
- [x] Move TAKE, GO NEXT, BACK, and BLACK into the lower-left sidebar.
- [x] Expand Preview and Program to equal monitor tracks.
- [x] Remove the title/status bars above Preview and Program.
- [x] Expand both canvases to the full monitor height.
- [x] Verify wide and narrow access, interaction behavior, and overflow.

**Comparison History**

- Initial issue: monitor labels and state chips duplicated information and reduced picture height.
- Fix: removed both visible monitor headers, preserved accessible monitor names, and let each canvas use the full monitor bounds.
- Post-fix evidence: `scenes-1280x800.png` and `monitor-header-comparison.png`; no actionable P0/P1/P2 findings remain.

**Follow-up Polish**

- None required for this scoped handoff.

## Source Inspector Compaction And Resizing

**Comparison Target**

- Source visual truth: `/Users/srdjankotarlic/Desktop/Screenshot 2026-08-11 at 13.01.58.png`.
- Rendered implementation: `/Users/srdjankotarlic/Documents/New project/protimer-studio-release/artifacts/generated/compositor/compositor-1280x800.png`.
- Combined comparison: `/Users/srdjankotarlic/Documents/New project/protimer-studio-release/artifacts/generated/compositor/source-inspector-comparison.png`.
- Viewport: 1280 x 768 CSS px for the wide operator state; 900 x 568 CSS px for the compact state.

**Findings**

- The Source inspector now opens at 350 px instead of owning a large flexible center track.
- Transform is summarized by default; Crop & Framing and Appearance retain the same progressive disclosure pattern.
- A visible edge control collapses the inspector to a 44 px rail and restores the selected source without losing state.
- The divider supports pointer resizing, Left/Right keyboard adjustment, and Home to return to the 350 px default.
- The chosen expanded width and collapsed state persist between launches.
- The narrow layout removes the horizontal divider and keeps the full inspector reachable through the existing vertical workspace scroll.
- No clipped labels, overlapping controls, horizontal overflow, or hidden destructive actions were found in the 1280 or 900 px states.

**Implementation Checklist**

- [x] Reduce the default Source inspector footprint.
- [x] Add full-panel collapse and expand.
- [x] Add pointer and keyboard resizing.
- [x] Preserve every existing source control and selected-layer state.
- [x] Verify wide and compact operator layouts.
- [x] Compare the reference and rendered implementation in one artifact.

## Multi-Output Canvas And Projector Mapping

**Comparison Target**

- Source visual truth: `/Users/srdjankotarlic/Desktop/Screenshot 2026-08-11 at 14.39.34.png`.
- Rendered implementation: `/Users/srdjankotarlic/Documents/New project/protimer-studio-release/artifacts/generated/compositor/output-routing-1159x745.png`.
- Combined comparison: `/Users/srdjankotarlic/Documents/New project/protimer-studio-release/artifacts/generated/compositor/output-routing-reference-comparison.png`.
- Projector editor evidence: `/Users/srdjankotarlic/Documents/New project/protimer-studio-release/artifacts/generated/compositor/composition-workspace-1280x800.png`.
- Mapped Program evidence: `/Users/srdjankotarlic/Documents/New project/protimer-studio-release/artifacts/generated/compositor/projector-mapped-output-1280x720.png`.
- Source pixels: 1147 x 745. Implementation pixels: 1159 x 745. Combined pixels: 2306 x 745. Both routing views use the same desktop-height state at device scale factor 1; the 12 px width difference is visible in the combined artifact and does not affect layout judgment.
- State: Output Routing open. The reference shows one unconfigured destination; the implementation intentionally shows two configured destinations to expose the requested independent canvases and mapping entry point.

**Full-View Comparison Evidence**

- The original modal hierarchy, dark palette, compact destination rows, sticky actions, and local vertical scrolling are preserved.
- The first destination shows its complete 1920 x 1080 Output canvas and active projector mapping without pushing Apply routing off screen.
- A second destination remains independently editable and reachable through the same local scroll area.

**Focused Region Comparison Evidence**

- The first destination is readable at original pixel size: display, role, mode, Program audio, format, canvas dimensions, scaling, mapping state, and Map projector are visually separated.
- The projector editor shows the selected surface, four visible corner handles, a calibration grid, numeric point controls, canvas coordinates, and its assigned output in one view.
- The mapped-output capture shows the complete Program surface transformed by the four points, with the calibration grid drawn above the content.

**Findings**

- No actionable P0, P1, or P2 visual or interaction issue remains for this scope.
- Fonts and typography: ShowSlate's existing system font, uppercase utility labels, weights, line heights, and zero letter-spacing convention remain consistent; no field label or action is clipped.
- Spacing and layout rhythm: the new Output canvas block follows the existing destination-card grid, uses the established 8 px-or-less radii, and preserves a stable sticky footer. The mapping inspector remains locally scrollable.
- Colors and visual tokens: existing blue action, green live/assigned, neutral pending, and red destructive semantics are retained; mapping controls do not introduce a competing palette.
- Image quality and assets: no raster or brand asset is added or degraded. The Program renderer remains sharp at its selected canvas size before the final display transform.
- Copy and content: labels distinguish physical destination mode from per-output canvas format and scaling. Mapping status and the visible Map projector action make the workflow discoverable.
- Accessibility and interaction: corner points support pointer dragging and numeric entry; destination controls remain keyboard-operable; the modal keeps local scroll rather than hiding controls below the viewport.

**Comparison History**

- Initial issue: every destination only exposed display placement, so operators could not see or set independent render canvases and there was no visible route into projector geometry.
- First implementation: added independent format, dimensions, scaling, mapping status, and a projector editor with draggable points and grid.
- Polish fix: strengthened the Map projector button contrast and width so it reads as an action rather than passive status text.
- Post-fix evidence: `output-routing-1159x745.png`, `composition-workspace-1280x800.png`, and `projector-mapped-output-1280x720.png`; no actionable P0/P1/P2 findings remain.

**Implementation Checklist**

- [x] Support multiple simultaneous display/window destinations.
- [x] Give every destination an independent resolution, format, frame rate, and scaling mode.
- [x] Open projector mapping from the selected destination.
- [x] Support four-corner point adjustment by drag and numeric entry.
- [x] Add configurable calibration-grid columns, rows, and opacity.
- [x] Apply mapping, blend, and scaling to the complete Program surface.
- [x] Verify independent canvases and mapped output in real Electron output windows.

**Follow-up Polish**

- P3: a future dedicated calibration view could temporarily hide all non-mapping controls when an operator is standing at the projection surface. It is not needed for the requested workflow.

final result: passed
