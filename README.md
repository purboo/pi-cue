# pi-cue

**A tap on your wrist when pi is done, or needs you.**

Pushes to your iPhone and Apple Watch through [Bark](https://github.com/Finb/Bark), but only when you are away. If you are at the keyboard, nothing happens.

## Setup

1. Install **Bark** from the App Store and allow notifications.
2. `pi install npm:pi-cue`
3. In pi: `/cue key <the URL Bark shows>`, then `/cue test`.

The key is stored in `~/.pi/agent/cue.json` (mode 600). `PI_CUE_KEY` and `PI_CUE_SERVER` work too.

## Use

Cues are **off** in every session until you turn them on, so parallel sessions don't all tap you.

| | |
|---|---|
| `/cue` | Toggle for this session. Remembered when you resume it. |
| `/cue on` · `/cue off` | Explicit. |
| `/cue test` | Send a sample. |
| `/cue status` | On/off, key, server. |

While on, `cue` shows in the status line.

## What you get

| | When | Level |
|---|---|---|
| `● repo` · Needs you | pi waits on a confirm / select / input for 8s | time-sensitive |
| `● repo` · Still waiting | the same decision is still open after 10 min (once) | time-sensitive |
| `✗ repo` · Failed | a run failed | time-sensitive |
| `✓ repo` · Done · 3m12s | a run of 30s or more finished, 15s ago | normal |

The body is the question, the error, or the first line of the answer.

## Quiet by design

- **Away only.** A cue waits out a grace period and is dropped if you pressed a key around that time. Escape-aborted runs never cue.
- **One per session.** Each session replaces its own notification instead of stacking.
- **Cleans up.** Answering, typing, starting a new run, or quitting removes the notification from the phone and watch. Removal needs Bark's *Background App Refresh*.
- **Never in the way.** Network errors are swallowed. Nested and headless sessions never cue.

The Watch only gets iPhone notifications while the iPhone is locked.

## Config

`~/.pi/agent/cue.json`, all optional except `key`:

```json
{
  "key": "…",
  "server": "https://api.day.app",
  "default": "on",
  "detail": false,
  "graceMs": 15000,
  "askGraceMs": 8000,
  "minRunMs": 30000,
  "remindMs": 600000
}
```

`"default": "on"` (or `PI_CUE=1`) starts new sessions with cues on. `"detail": false` sends only the project and state, never text from the session; worth it on the public Bark server. `remindMs: 0` disables the reminder.

## Development

```bash
bun install
bun run link-pi
bun run check        # tsc + bun test
pi -e ./index.ts     # try it
```
