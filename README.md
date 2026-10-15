# Splitframe-Speedrun-comparasion-
not perfect

---

## Splitframe

A responsive, dark comparison workspace for gaming videos and speedruns.

Live site: https://splitframe.neatprawn1.chatgpt.site

## Use

Paste a supported link into either run and press **Load**, or use **Choose video**
to open a local recording. Set independent starting points, choose the video's
FPS, and use the toolbar to play or pause the controllable video or both together.
**Reset** pauses supported videos and returns to their saved starts.

**Space** toggles playback and **R** resets. These shortcuts work after using
the toolbar and alignment buttons, while leaving text entry and file selection
alone. Click outside an embedded player before using page shortcuts; keyboard
events inside another site's iframe cannot reach the comparison page.

## Supported sources

| Source | Toolbar play / pause | Start points / reset | Speed selector |
| --- | --- | --- | --- |
| Local video files | Yes | Yes | 0.25–2× |
| YouTube videos | Yes | Yes | Available rates |
| Twitch VODs | Yes | Yes | Native player only |
| Twitch clips | Own player controls | No | Native player only |
| X / Twitter video posts | Yes | Yes | 0.25–2× |
| Direct video.twimg.com MP4 links | Yes | Yes | 0.25–2× |

Twitch live streams are intentionally unsupported. Paste a recorded
`twitch.tv/videos/...` link. Twitch setup is explicit: click Play inside each
Twitch player once. Splitframe confirms actual playback, pauses the player at
its saved start, and then enables shared Play. This handles the initial player
activation observed in browser testing without leaving a false buffering state.
The start-point menus sit above the videos, with the shared toolbar directly
below both players. Shared Play does not scroll the page when pressed.
Click outside embedded players to send Space and R to Splitframe.

X post URLs resolve public video metadata through the [FxEmbed Status API](https://github.com/FxEmbed/FxEmbed/wiki/Status-Fetch-API).
The media downloads without a third-party referrer and plays through a temporary
browser-local URL, with shared play/pause, timestamps, reset and speed controls.
Large X videos take longer to load; replacing a run releases its temporary URL.
The original X link remains available for attribution, and saved
sessions retain that post URL rather than an expiring CDN link. The lookup sends
only the post ID, without credentials. It accepts HTTPS MP4 media only from
`video.twimg.com`. Private, deleted, non-video or unavailable posts show an error.
The lookup service is an external dependency; it needs no API key. Only Twitch
clips use independent controls.

Start points range from 0 to 600 seconds; full videos remain playable.
Frame buttons request a fractional-second seek using the selected FPS.
Embedded players can seek to a nearby frame, and ads or buffering can affect
synchronization. This is a review tool rather than an exact run timer.

## Local files and saved sessions

Local recordings play directly from the device and are never uploaded.
Only file metadata and alignment settings are saved in the browser. Reselect
files after refreshing to restore their starting points and FPS. Browser codec
support determines which formats can be decoded. Direct MP4 URLs can expire;
local copies remain useful when remote media is unavailable.

## Run and test

No build step or dependencies are needed. Serve `dist/` over HTTP or HTTPS:

```sh
python3 -m http.server 8000 --directory dist
```

Open http://localhost:8000. Test the controller and provider contracts with
Node.js 22 or newer:

```sh
npm test
```

The tests cover URL formats, shared and partial playback, independent resets,
frame boundaries, keyboard focus, delayed SDK events, file lifecycle, X lookup
and media failures, Twitch readiness, muted recovery, delayed buffering,
cancelled retries, Twitch activation, unanswered requests, state reconciliation,
X video resolution and referrer-free downloads,
and provider API commands. Provider and media doubles are
used, so passing tests do not establish real network playback in a browser.

## Hosting

Deploy the contents of `dist/` to an HTTPS static host. Twitch parent domains
and the YouTube origin are taken from the actual page. Keep a referrer policy
that supplies the embedding origin. Site-specific hosting identity is separate
from the portable application source.
