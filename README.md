# Splitframe-Speedrun-comparasion-
not perfect

---

## Splitframe

A dark, responsive comparison workspace for gaming videos and speedruns.

Live site: https://splitframe.neatprawn1.chatgpt.site

Paste a link into each run or choose a local video. Set independent starting
points, then use the shared **Play / Pause** button beneath the videos.
**Reset** returns both videos to their saved starts. **Space** toggles playback
and **R** resets; shortcuts leave text fields and native video controls alone.

| Source | Shared playback | Start points / reset | Speed |
| --- | --- | --- | --- |
| YouTube | Yes | Yes | Available player rates |
| Public Twitch VOD | Yes | Yes | 0.25–2× |
| Public Twitch clip | Yes | Yes | 0.25–2× |
| Public X video post / direct MP4 | Yes | Yes | 0.25–2× |
| Local video file | Yes | Yes | 0.25–2× |

Each timeline scales to the loaded video's full duration. Frame nudges use the
selected FPS; video seeking and streaming timing remain approximate.
The start-point menus sit above the videos and the shared controls below them.

## Twitch playback

VODs stream through HLS.js 1.7.3 (vendored under its Apache-2.0 license).
Clips use the browser's native video element. Both use the same control adapter
as local and X recordings, so shared Play controls their actual media elements.
No initial click inside a Twitch iframe is required.

The Site Worker requests public Twitch playback metadata. VOD playlists and
segments use signed, expiring, host-restricted relay URLs so browser cross-origin
restrictions do not prevent playback. Segments stream through the service;
recordings are not saved. The relay signing key is a secret runtime variable
named `TWITCH_RELAY_KEY`; never commit its value.

Twitch live streams are unsupported. Private, subscriber-only, deleted and
otherwise restricted recordings fail with a readable error. No Twitch sign-in
or user credentials are collected. Resolution relies on Twitch's public browser
playback service; changes upstream can require maintenance.

## X and local files

Public X post metadata is resolved through the
[FxEmbed Status API](https://github.com/FxEmbed/FxEmbed/wiki/Status-Fetch-API).
Only trusted HTTPS `video.twimg.com` MP4s are accepted. They download without a
third-party referrer and use a temporary browser-local URL, released when the
run is replaced. Large videos can take longer to load.

Local files play on the device and are never uploaded. The browser saves only
source links, file metadata and comparison preferences. Reselect local files
after refreshing. Original source links remain available beside each video.

## Development and hosting

- `web/` contains the browser application and vendored HLS player.
- `worker/index.js` serves the app and public Twitch playback routes.
- `scripts/build.mjs` embeds browser assets into `dist/server/index.js`.
- Sites hosting identity stays in `.openai/hosting.json` and is not needed
  in the portable GitHub source.

No package dependencies or installation are required. Use Node.js 22 or newer:

```sh
npm test
npm run build
node scripts/validate-artifact.mjs
```

Deploy the generated Worker as an ES module, configure `TWITCH_RELAY_KEY` as a
secret, and serve over HTTPS. The supported Sites workflow packages the Worker
and hosting manifest together. A static-file server alone does not provide
Twitch playback routes.

Tests cover native Twitch VOD/clip controls, long-video start points, media
cleanup, YouTube commands, X resolution, failed loads, shared playback, keyboard
focus, restricted recordings, playlist rewriting, relay signatures, range
requests and streamed responses. Provider doubles do not establish real network
playback; the deployed site also needs browser verification.
