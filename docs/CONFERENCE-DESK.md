# Conference Desk Workflow

ShowSlate Conference Desk coordinates one conference room from one local operator workspace. The normal path is:

`show folder -> setup wizard -> output roles -> preflight -> Live Mode -> GO`

The built-in Canvas can compose selected windows, media, cameras and UVC capture devices for room displays. It is not an advanced camera switcher, audio mixer or streaming encoder. Its primary job is to keep the room rundown, timer, linked content, speaker lower third and destination screens on the same cue and Program state.

## Try it without files

Start with an empty workspace and select **Load conference demo**. The demo contains six cues, linked holding graphics and cue-driven speaker data. It does not open an external display automatically.

Select **Outputs** to assign a physical display, run **Preflight**, then use **Test outputs** before pressing GO.

## Prepare a show folder

A show folder can contain the schedule at its root and media in any normal subfolder:

```text
Product Summit/
  rundown.csv
  opening.png
  media/
    keynote.pdf
    panel.webm
    coffee-break.png
```

The importer accepts one `.csv`, `.tsv` or `.txt` schedule. Preferred schedule names are `rundown`, `schedule`, `run-of-show`, `show`, `agenda` and `program`. When several schedules exist, ShowSlate selects the highest-priority file and reports the others.

Excel `.xlsx` and `.xls` files are not parsed directly. Export the rundown sheet as CSV/TSV or paste its rows into the wizard. This keeps the import path small, inspectable and independent of spreadsheet macros.

## Recommended columns

| Header | Required | Meaning |
|---|---:|---|
| `session` or `name` | yes | Rundown cue name |
| `duration` | yes | Minutes, `MM:SS` or `HH:MM:SS` |
| `note` | no | Operator note |
| `speaker` | no | Speaker name used by automatic lower thirds |
| `speaker title` | no | Role or title |
| `company` | no | Organization |
| `media` | no | Exact filename or relative path to linked content |
| `room` | no | Room/stage metadata |
| `auto lower third` | no | `yes` or `no`; defaults to yes when a speaker exists |
| `auto content` | no | `yes` or `no`; defaults to yes when `media` exists |
| `hide lower third` | no | Hide the previous lower third before the next GO |
| `skip repeated lower third` | no | Avoid taking the same speaker/template twice in a row |
| `lower third session` | no | Session text available to custom lower-third templates |
| `segment` | no | Segment text available to custom templates |
| `custom` | no | Additional dynamic template field |

Example:

```csv
session,duration,note,speaker,speaker title,company,media,room
Opening,05:00,Host welcome,Ana Markovic,Conference Host,Example Events,opening.png,Main Room
Keynote,30:00,Main presentation,Dr Maya Chen,Keynote Speaker,Northstar,media/keynote.pdf,Main Room
Coffee Break,15:00,Lobby refreshments,,,,media/coffee-break.png,Main Room
```

Rows with an invalid or empty duration are skipped and reported. A header row is strongly recommended.

## Media matching

The importer copies supported files into ShowSlate's private media storage. It never executes imported files.

Matching is deliberately conservative:

1. An exact `media` filename or relative path wins.
2. Without `media`, an asset can match an exact normalized cue title.
3. One asset is assigned to at most one cue during automatic matching.
4. Unmatched cues and unused assets remain visible in the import summary.

Supported show-folder media: PNG, JPEG, WebP, GIF, SVG, MP4, WebM, MOV, M4V and PDF.

Import safety limits are 500 files, 1 GB total, 200 MB per asset and 5 MB for the schedule. Hidden files, `__MACOSX` metadata and symbolic links are skipped.

## Assign output roles

The setup wizard creates an **Audience** route. Open **Outputs** to add the remaining room destinations:

- **Audience** for projector, LED wall or room display content.
- **Confidence** for the current cue, next cue, speaker timer and messages.
- **Timer** for a clean dedicated stage timer.
- **Stream Graphics** for a transparent lower-third window.
- **Door Agenda** for the room name, current session, next session and clock.

Every route keeps an explicit display identity and placement. Select **Apply routing** after changes. An unavailable display blocks that route instead of silently moving it to another monitor.

## Preflight

Preflight checks the saved show, rundown, assets, output assignments, cue actions, media mapping and local services. Conference Desk also checks that an Audience route exists.

Select **Test outputs** to open the configured destinations and wait for renderer confirmation. A green open window is not enough: the destination must acknowledge the current Program revision and expected cue state.

Warnings can be appropriate, such as disabled chimes or output delivery not tested yet. Resolve every blocking check before opening the room.

## Run the room

1. Confirm the Program monitor and output status.
2. Select the row that should become NEXT.
3. Enter **Live Mode** to protect import and editing actions.
4. Press **GO**.

GO updates the LIVE cue, timer, linked media and immediate automatic lower third in one Program revision. Delayed lower thirds are intentionally emitted later when their configured delay expires.

Use **BLACKOUT** for an immediate black Audience/Timer output, **HIDE** to remove lower thirds and **Stop all** when destinations must close. Keep a printed or independent digital rundown and a fallback timer for show-critical work.

## Sample folder

The repository includes [`examples/conference-show`](../examples/conference-show) with a ready CSV and SVG media. It is intended for source users and import testing. Installer users can use the built-in conference demo instead.
