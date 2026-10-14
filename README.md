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
| X / Twitter post links | Own player controls | No | Native player only |
| Direct video.twimg.com MP4 links | Yes | Yes | 0.25–2× |

Twitch live streams are intentionally unsupported. Paste a recorded
`twitch.tv/videos/...` link. Shared controls wait for the VOD metadata and retry
an unanswered first play command once. The toolbar sits above the players and
stays reachable as you scroll. Play and Space bring Twitch players into view;
Twitch can ignore API playback requests when the embed is outside the viewport.
Keep both Twitch players visible during a comparison.

If Twitch blocks playback with sound,
Splitframe retries muted and updates the audio selector. Slow buffering does
not stop playback. An unanswered Play request shows Starting instead of assuming
buffering. After eight seconds, if Twitch confirms it remained paused, the pair
pauses with a prompt to activate Twitch's own Play button once. Unpaused or unknown
states keep waiting without a forced stop. Advancing timestamps can confirm
playback if the SDK misses a Playing event. Click inside Twitch before enabling
audio if your browser requires it. If prompted, start Twitch inside its player,
pause it, click outside the iframe, and retry the shared controls.

A source with independent controls does not disable toolbar controls for the
other video. To link playback for footage from an X post, use its direct HTTPS
`video.twimg.com` MP4 URL or load a local recording. Public post embeds preserve
X's attribution and native player; private, deleted, or restricted posts may
not be embeddable. No platform API keys are required.

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
frame boundaries, keyboard focus, delayed SDK events, file lifecycle, X widget
rendering failures, Twitch readiness, muted recovery, delayed buffering,
cancelled retries, viewport alignment, unanswered requests, state reconciliation,
and provider API commands. Provider and media doubles are
used, so passing tests do not establish real network playback in a browser.

## Hosting

Deploy the contents of `dist/` to an HTTPS static host. Twitch parent domains
and the YouTube origin are taken from the actual page. Keep a referrer policy
that supplies the embedding origin. Site-specific hosting identity is separate
from the portable application source.
