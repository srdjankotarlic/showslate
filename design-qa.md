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

final result: passed
