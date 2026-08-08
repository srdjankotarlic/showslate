# ShowSlate control reference

ShowSlate uses its existing local HTTP and OSC services for Bitfocus Companion,
Stream Deck, QLab and other show-control tools. There is no separate service and no
official Companion module in this beta. Companion's Generic HTTP or OSC connections
can use the mappings below.

## Connection

- HTTP base: the `API / Companion` address shown in **Network & Outputs**.
- HTTP authentication: add `t=<launch-token>` to the query string or send the
  `x-showslate-token` header. The token changes whenever ShowSlate starts. The
  legacy `x-pt-token` header remains accepted for existing integrations.
- OSC: UDP on the OSC port shown in the app (normally `7879`). OSC is intentionally
  tokenless and must only be used on a trusted production LAN.
- A `200` command response means the command was accepted. Read status to confirm
  the resulting live state; for example, `GO SELECTED` cannot act when no cue is selected.

## Actions

Every action supports HTTP GET:

```text
http://HOST:PORT/cmd?type=goNext&t=TOKEN
```

HTTP POST uses JSON and the `x-showslate-token` header:

```json
{"type":"messageSend","value":"WRAP UP"}
```

| Companion action | HTTP `type` | Value | OSC address |
| --- | --- | --- | --- |
| Start / pause | `startPause` | none | `/showslate/start-pause` |
| Reset timer | `reset` | none | `/showslate/reset` |
| Adjust time | `adjust` | signed seconds | `/showslate/adjust` |
| GO using normal operator logic | `go` | none | `/showslate/go` |
| GO next cue | `goNext` | none | `/showslate/go/next` |
| GO selected cue | `goSelected` | none | `/showslate/go/selected` |
| Set blackout | `blackout` | `on`, `off`, or `toggle` | `/showslate/blackout` |
| Set duration | `setDuration` | milliseconds | `/showslate/set-duration` |
| Set timer mode | `mode` | `countdown`, `countup`, or `clock` | `/showslate/mode` |
| Send speaker message | `messageSend` | text | `/showslate/message/send` |
| Clear speaker message | `messageClear` | none | `/showslate/message/clear` |
| Take active lower third | `ltTake` | none | `/showslate/lt/take` |
| Hide lower third | `ltHide` | none | `/showslate/lt/hide` |
| Replay last taken lower third | `ltReplay` | none | `/showslate/lt/replay` |
| Select LT template | `ltSelectTemplate` | template ID or exact name | `/showslate/lt/select-template` |
| Set automatic LT | `ltAuto` | `on` or `off` | `/showslate/lt/auto` |
| Take selected screen content | `contentTake` | `transition` or `cut` | `/showslate/content/take` |
| Clear live screen content | `contentClear` | none | `/showslate/content/clear` |

The older HTTP names `start`, `message` and `clearMessage`, plus legacy
`/protimer/...` OSC addresses, remain accepted.

### Action semantics

- `GO NEXT` ignores the Preview selection and advances from the LIVE cue.
- `GO SELECTED` only takes the cue currently selected in the rundown.
- Selecting a cue, LT template or slide never changes Program by itself.
- `LT TAKE` resolves the active template with data from the LIVE cue.
- `LT REPLAY` creates a new runtime instance of the last successfully taken graphic.
- `contentTake` takes the currently selected Slides item; `contentClear` clears only
  live screen content.

## Status

Status is read-only, JSON, `Cache-Control: no-store`, and requires the same HTTP token:

| Status | Endpoint |
| --- | --- |
| Full operator status | `/api/status?t=TOKEN` |
| Show, timer, output and message | `/api/status/show?t=TOKEN` |
| LIVE, selected and next cue | `/api/status/cue?t=TOKEN` |
| Lower-third runtime | `/api/status/lower-third?t=TOKEN` |
| Selected and live screen content | `/api/status/content?t=TOKEN` |

The status payload is deliberately bounded. It does not contain the launch token,
private configuration, template library, media assets, full rundown or cue notes.

## Feedbacks

Recommended Companion feedbacks and their JSON fields:

| Feedback | JSON field / condition |
| --- | --- |
| Timer running | `status.timer.running === true` |
| Timer paused | `status.timer.running === false` |
| Blackout active | `status.output.blackout === true` |
| Output open | `status.output.open === true` |
| Lower third live | `status.lowerThird.visible === true` |
| LT auto enabled | `status.lowerThird.auto === true` |
| Screen content live | `status.content.live !== null` |
| Cue selected but not live | selected cue ID differs from live cue ID |

## Variables

Useful Companion variables are available from the full status response:

| Variable | JSON field |
| --- | --- |
| Show name | `status.show.name` |
| Timer mode | `status.timer.mode` |
| Remaining milliseconds | `status.timer.remainingMs` |
| LIVE cue name | `status.cue.live.name` |
| Selected cue name | `status.cue.selected.name` |
| Next cue name | `status.cue.next.name` |
| Speaker name | `status.lowerThird.speakerName` |
| LT template | `status.lowerThird.templateName` |
| LT phase | `status.lowerThird.phase` |
| Live content name | `status.content.live.name` |
| Speaker message | `status.message.text` |

When the countdown is running, `remainingMs` is materialized at query time. The
response also includes `updatedAt` and `queriedAt` so an integration can detect stale
controller data.
