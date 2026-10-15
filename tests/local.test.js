import test from 'node:test';
import assert from 'node:assert/strict';
import { ComparisonSession, localVideoSource, parseVideoUrl } from '../dist/core.js';
import { createPlayer, localVideoError, resolveXVideo } from '../dist/players.js';

class NativeVideo extends EventTarget {
  constructor() {
    super(); this.paused = true; this.duration = 90; this.currentTime = 0;
    this._rate = 1; this.attributes = {}; this.loads = 0;
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; if (name === 'src') this.src = ''; }
  emit(type) { this.dispatchEvent(new Event(type)); }
  get playbackRate() { return this._rate; }
  set playbackRate(rate) { this._rate = rate; this.emit('ratechange'); }
  play() { this.paused = false; this.emit('play'); this.emit('playing'); return Promise.resolve(); }
  pause() { if (!this.paused) { this.paused = true; this.emit('pause'); } }
  load() { this.loads++; }
  remove() { if (this.mount) this.mount.child = null; }
}
function environment() {
  const videos = [];
  globalThis.document = {
    createElement(tag) { if (tag === 'div') return { isConnected: true }; assert.equal(tag, 'video', 'A local file must not create an SDK script or remote iframe'); const video = new NativeVideo(); videos.push(video); return video; }
  };
  return { videos, mount: { replaceChildren(video) { if (this.child) this.child.isConnected = false; this.child = video; video.mount = this; video.isConnected = true; } } };
}
function file(name = 'my-run.mp4', type = 'video/mp4') {
  return Object.assign(new Blob(['sample video bytes'], { type }), { name, lastModified: 123 });
}
function remoteAdapter() {
  return { ready: Promise.resolve(), playing: false, current: 0, play() { this.playing = true; }, pause() { this.playing = false; }, seek(time) { this.current = time; }, mute() {}, time() { return this.current; }, duration: () => 900, rates: () => [0.5, 1, 2], setRate() {}, destroy() {} };
}

test('local file selection rejects non-videos and empty files before replacing the current run', () => {
  assert.equal(localVideoSource(file()).kind, 'local');
  assert.equal(localVideoSource(file('recording.MP4', '')).control, true);
  assert.equal(localVideoSource(file('clip.webm', 'video/webm')).seekable, true);
  assert.throws(() => localVideoSource({ name: 'empty.mp4', size: 0, type: 'video/mp4' }), /empty/);
  assert.throws(() => localVideoSource(file('notes.txt', 'text/plain')), /video file/);
});

test('native local player exposes metadata, seeking, audio, actual speed events, and playback states', async t => {
  const env = environment(), chosen = file(), states = [], rates = [];
  const adapter = await createPlayer(env.mount, localVideoSource(chosen), { file: chosen, onState: state => states.push(state), onRate: rate => rates.push(rate) });
  t.after(() => adapter.destroy());
  const video = env.videos[0];
  assert.match(video.src, /^blob:/); assert.equal(video.controls, true); assert.equal(video.muted, true); assert.equal(video.autoplay, false);
  video.emit('loadedmetadata'); await adapter.ready;
  adapter.seek(12.375); assert.equal(adapter.time(), 12.375); assert.equal(adapter.duration(), 90);
  adapter.play(); adapter.pause(); assert.deepEqual(states, ['buffering', 'playing', 'paused']);
  adapter.mute(false); assert.equal(video.muted, false);
  adapter.setRate(0.75); assert.deepEqual(rates, [0.75]); assert.ok(adapter.rates().includes(0.75));
});

test('a local file and online video share commands and reset to their separate start points', async t => {
  const env = environment(), chosen = file(), session = new ComparisonSession();
  const token = session.begin(0, localVideoSource(chosen), { start: 12.5, fps: 60 });
  const native = await createPlayer(env.mount, session.slots[0].source, { file: chosen, onState: state => session.state(0, token, state) });
  t.after(() => native.destroy());
  env.videos[0].emit('loadedmetadata'); await session.attach(0, token, native);
  const remote = remoteAdapter(), tokenB = session.begin(1, parseVideoUrl('https://youtu.be/M7lc1UVf-VE'), { start: 45 });
  await session.attach(1, tokenB, remote);
  session.toggle(); assert.equal(env.videos[0].paused, false); assert.equal(remote.playing, true);
  session.toggle(); assert.equal(env.videos[0].paused, true); assert.equal(remote.playing, false);
  session.reset(); assert.equal(native.time(), 12.5); assert.equal(remote.current, 45);
  session.nudge(0, 1, true); assert.ok(Math.abs(native.time() - (12.5 + 1 / 60)) < 1e-10);
});

test('replacing a local file revokes its object URL once and clears the native media resource', async t => {
  const env = environment(), chosen = file(), revoked = [];
  const originalRevoke = URL.revokeObjectURL.bind(URL);
  t.mock.method(URL, 'revokeObjectURL', url => { revoked.push(url); originalRevoke(url); });
  const adapter = await createPlayer(env.mount, localVideoSource(chosen), { file: chosen });
  const url = env.videos[0].src;
  adapter.destroy(); adapter.destroy(); await adapter.ready;
  assert.deepEqual(revoked, [url]); assert.equal(env.videos[0].src, ''); assert.equal(env.videos[0].loads, 1); assert.equal(env.mount.child, null);
});

test('unsupported codecs reject readiness with an actionable error and do not start playback', async t => {
  const env = environment(), chosen = file('my-run.mkv', ''), errors = [];
  const adapter = await createPlayer(env.mount, localVideoSource(chosen), { file: chosen, onError: message => errors.push(message) });
  t.after(() => adapter.destroy());
  const video = env.videos[0]; video.error = { code: 4 }; video.emit('error');
  await assert.rejects(adapter.ready, /format or codec/);
  assert.match(errors[0], /MP4 or WebM/); assert.equal(video.paused, true);
  assert.match(localVideoError(3), /decode/);
});

test('local playback promise rejection is handled without leaving the paired video running', async t => {
  const env = environment(), chosen = file(), session = new ComparisonSession();
  const token = session.begin(0, localVideoSource(chosen));
  const adapter = await createPlayer(env.mount, session.slots[0].source, { file: chosen, onState: state => session.state(0, token, state) });
  t.after(() => adapter.destroy());
  env.videos[0].emit('loadedmetadata'); await session.attach(0, token, adapter);
  const remote = remoteAdapter(); const otherToken = session.begin(1, parseVideoUrl('https://twitch.tv/videos/123'));
  await session.attach(1, otherToken, remote);
  session.state(1, otherToken, 'playing');
  env.videos[0].play = () => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
  session.toggle(); await Promise.resolve(); await Promise.resolve();
  assert.equal(session.slots[0].status, 'blocked'); assert.equal(session.active, false); assert.equal(remote.playing, false);
});

test('saved local sessions contain only file metadata and retain start/FPS for reselection', async () => {
  const session = new ComparisonSession(), chosen = file();
  const token = session.begin(0, localVideoSource(chosen), { start: 33.25, fps: 30 });
  session.state(0, token, 'reselect');
  const saved = session.snapshot(); const serialized = JSON.stringify(saved);
  assert.equal(saved.slots[0].url, ''); assert.equal(saved.slots[0].localFile.name, chosen.name);
  assert.equal(saved.slots[0].start, 33.25); assert.equal(saved.slots[0].fps, 30);
  assert.equal(serialized.includes('blob:'), false); assert.equal(serialized.includes('sample video bytes'), false);
  const restoredSource = localVideoSource(saved.slots[0].localFile);
  assert.equal(restoredSource.filename, chosen.name); assert.equal(restoredSource.lastModified, chosen.lastModified);
  assert.equal(session.canPlay, false);
});

test('a direct X MP4 uses the native controllable player without creating or revoking a local URL', async t => {
  const env = environment(); const source = parseVideoUrl('https://video.twimg.com/ext_tw_video/123/pu/vid/run.mp4?tag=12');
  const adapter = await createPlayer(env.mount, source);
  t.after(() => adapter.destroy());
  const video = env.videos[0]; assert.equal(video.src, source.url);
  video.emit('loadedmetadata'); await adapter.ready;
  adapter.play(); assert.equal(video.paused, false);
  adapter.seek(5.5); assert.equal(adapter.time(), 5.5);
  adapter.setRate(0.5); assert.equal(video.playbackRate, 0.5);
  adapter.pause(); assert.equal(video.paused, true);
});


test('X post links resolve into the same native player used by local recordings', async t => {
  const env = environment();
  globalThis.window = { location: { hostname: 'compare.example', ancestorOrigins: [] } };
  window.self = window; window.top = window;
  const source = parseVideoUrl('https://x.com/runner/status/123456789/video/2?t=5');
  const mediaUrl = 'https://video.twimg.com/ext_tw_video/1/pu/vid/clip.mp4?tag=12';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.fxtwitter.com/i/status/123456789');
    assert.equal(options.credentials, 'omit');
    return { ok: true, status: 200, json: async () => ({ code: 200, tweet: { id: '123456789', media: { videos: [{ url: 'https://video.twimg.com/first.mp4' }, { url: mediaUrl }] } } }) };
  });
  const session = new ComparisonSession();
  const token = session.begin(0, source);
  const player = await createPlayer(env.mount, source, { onState: state => session.state(0, token, state) });
  t.after(() => session.clear());
  assert.equal(env.videos[0].src, mediaUrl);
  env.videos[0].emit('loadedmetadata'); await session.attach(0, token, player);
  const other = remoteAdapter(); const b = session.begin(1, parseVideoUrl('https://twitch.tv/videos/123'));
  await session.attach(1, b, other);
  session.state(1, b, 'playing');
  session.toggle(); assert.equal(env.videos[0].paused, false); assert.equal(other.playing, true);
  session.toggle(); assert.equal(env.videos[0].paused, true); assert.equal(other.playing, false);
  session.reset(); assert.equal(player.time(), 5);
  assert.match(session.snapshot().slots[0].url, /x.com.*video\/2/);
  assert.equal(JSON.stringify(session.snapshot()).includes('video.twimg.com'), false);
});

test('X lookup rejects unavailable posts, missing videos and untrusted media URLs', async t => {
  const source = parseVideoUrl('https://x.com/runner/status/123');
  const responses = [
    { ok: false, status: 404 },
    { ok: true, status: 200, json: async () => ({ code: 200, tweet: { id: '123', media: { videos: [] } } }) },
    { ok: true, status: 200, json: async () => ({ code: 200, tweet: { id: '123', media: { videos: [{ url: 'https://evil.example/run.mp4' }] } } }) },
    { ok: true, status: 200, json: async () => ({ code: 200, tweet: { id: '456', media: { videos: [] } } }) }
  ];
  t.mock.method(globalThis, 'fetch', async () => responses.shift());
  await assert.rejects(resolveXVideo(source), /private, deleted, or unavailable/);
  await assert.rejects(resolveXVideo(source), /no playable video/);
  await assert.rejects(resolveXVideo(source), /supported MP4/);
  await assert.rejects(resolveXVideo(source), /different post/);
});
