import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoUrl, parseTime, formatTime, shortcutAction, ComparisonSession } from '../web/core.js';

const YT_ID = 'M7lc1UVf-VE';
const yt = () => parseVideoUrl(`https://youtube.com/watch?v=${YT_ID}`);
const vod = () => parseVideoUrl('https://twitch.tv/videos/123456789');

function adapter({ duration = 1200, ready = Promise.resolve(), rates = [0.25, 0.5, 1, 1.5, 2] } = {}) {
  const calls = [];
  return {
    calls, ready, current: 0,
    play() { calls.push(['play']); }, pause() { calls.push(['pause']); },
    seek(value) { this.current = value; calls.push(['seek', value]); },
    mute(value) { calls.push(['mute', value]); },
    destroy() { calls.push(['destroy']); },
    time() { return this.current; }, duration() { return duration; },
    rates() { return rates; }, setRate(value) { calls.push(['rate', value]); }
  };
}
async function loadedPair(sources = [yt(), vod()], starts = [12.345, 34.567]) {
  const session = new ComparisonSession();
  const players = [adapter(), adapter({ rates: [] })];
  for (let index = 0; index < 2; index++) {
    const token = session.begin(index, sources[index], { start: starts[index] });
    await session.attach(index, token, players[index]);
  }
  players.forEach(p => p.calls.length = 0);
  return { session, players };
}

test('YouTube watch, short, mobile, live, embedded, and share links normalize to the same video', () => {
  const links = [`https://youtube.com/watch?v=${YT_ID}&si=abc`, `youtu.be/${YT_ID}`, `https://m.youtube.com/watch?v=${YT_ID}`, `https://music.youtube.com/watch?v=${YT_ID}`, `https://youtube.com/shorts/${YT_ID}`, `https://youtube.com/live/${YT_ID}`, `https://youtube-nocookie.com/embed/${YT_ID}`, `https://www.youtube.com/v/${YT_ID}`];
  for (const link of links) assert.equal(parseVideoUrl(link).id, YT_ID, link);
});

test('URL timestamps accept seconds, units, fragments and times beyond ten minutes', () => {
  assert.equal(parseVideoUrl(`https://youtu.be/${YT_ID}?t=1m23s`).start, 83);
  assert.equal(parseVideoUrl(`https://youtube.com/watch?v=${YT_ID}#t=42.5`).start, 42.5);
  assert.equal(parseVideoUrl('https://twitch.tv/videos/123?t=0h2m3s').start, 123);
  const beyond = parseVideoUrl(`https://youtu.be/${YT_ID}?start=700`);
  assert.equal(beyond.start, 700); assert.equal(beyond.clamped, false);
});

test('Twitch VODs and both clip formats have the right capabilities; live links are rejected', () => {
  assert.equal(parseVideoUrl('https://player.twitch.tv/?video=v12345').id, '12345');
  assert.equal(vod().seekable, true);
  assert.equal(parseVideoUrl('https://twitch.tv/runner/v/12345').id, '12345');
  assert.throws(() => parseVideoUrl('https://www.twitch.tv/twitchdev'), /live streams aren’t supported/);
  assert.throws(() => parseVideoUrl('https://player.twitch.tv/?channel=twitchdev'), /live streams aren’t supported/);
  for (const link of ['https://clips.twitch.tv/HelpfulClip-Slug123', 'https://www.twitch.tv/runner/clip/HelpfulClip-Slug123', 'https://clips.twitch.tv/embed?clip=HelpfulClip-Slug123']) {
    const source = parseVideoUrl(link);
    assert.equal(source.kind, 'twitch-clip'); assert.equal(source.control, true); assert.equal(source.seekable, true);
  }
});

test('invalid and unsafe sources are rejected without executing or embedding them', () => {
  for (const link of ['', 'https://youtube.com/playlist?list=123', 'https://youtube.com/@runner', 'https://youtube.com/watch?v=short', 'https://twitch.tv/directory', 'https://twitch.tv/videos/not-a-number', 'https://twitch.tv/collections/123', 'https://youtube.com.evil.test/watch?v=M7lc1UVf-VE', 'javascript:alert(1)', 'https://user:password@youtube.com/watch?v=M7lc1UVf-VE', 'https://example.com/video']) assert.throws(() => parseVideoUrl(link), link);
});

test('manual times and display rounding handle boundaries without guessing', () => {
  assert.equal(parseTime('1:23.500'), 83.5); assert.equal(parseTime('1:02:03'), 3723);
  assert.equal(parseTime('90.125'), 90.125); assert.equal(parseTime('2m3s'), 123);
  for (const input of ['1:65', '1:61:00', '-3', 'hello', '1.2.3', '']) assert.equal(parseTime(input), null, input);
  assert.equal(formatTime(59.9996), '01:00.000'); assert.equal(formatTime(600), '10:00.000');
  assert.equal(formatTime(3600.5), '1:00:00.500');
});

test('shared toggle calls both players and reset returns to independent starts while paused', async () => {
  const { session, players } = await loadedPair();
  assert.equal(session.canPlay, true); assert.equal(session.canReset, true);
  session.toggle();
  assert.equal(players[0].calls.at(-1)[0], 'play'); assert.equal(players[1].calls.at(-1)[0], 'play');
  session.toggle(); assert.equal(session.active, false);
  session.reset();
  assert.equal(players[0].current, 12.345); assert.equal(players[1].current, 34.567);
  assert.equal(players[0].calls.at(-1)[0], 'pause'); assert.equal(players[1].calls.at(-1)[0], 'pause');
});

test('frame nudges use chosen FPS and repeated second nudges clamp both boundaries', async () => {
  const { session } = await loadedPair();
  session.setStart(0, 0); session.setFPS(0, 60);
  for (let i = 0; i < 60; i++) session.nudge(0, 1, true);
  assert.ok(Math.abs(session.slots[0].start - 1) < 1e-10);
  session.setFPS(0, 30); session.nudge(0, -1, true);
  assert.ok(Math.abs(session.slots[0].start - (1 - 1 / 30)) < 1e-10);
  session.setStart(0, 595); session.nudge(0, 10); assert.equal(session.slots[0].start, 605);
  session.setStart(0, 1199); session.nudge(0, 10); assert.equal(session.slots[0].start, 1199.999);
  session.setStart(0, 2); session.nudge(0, -5); assert.equal(session.slots[0].start, 0);
});

test('seek operations respect short video durations including metadata learned later', async () => {
  const session = new ComparisonSession();
  const short = adapter({ duration: 40 });
  let token = session.begin(0, yt(), { start: 600 });
  await session.attach(0, token, short);
  assert.ok(session.slots[0].start < 40); assert.ok(short.current < 40);
  const second = adapter(); token = session.begin(1, vod()); await session.attach(1, token, second);
  session.setStart(0, 60); assert.ok(short.current < 40);
  short.duration = () => 20; session.reset(); assert.ok(short.current < 20);
});

test('a Twitch clip and VOD both receive shared playback and independent reset commands', async () => {
  const { session, players } = await loadedPair([vod(), parseVideoUrl('https://clips.twitch.tv/HelpfulClipSlug')]);
  assert.equal(session.canPlay, true); assert.equal(session.canReset, true);
  session.toggle();
  assert.equal(players[0].calls.some(c => c[0] === 'play'), true);
  assert.equal(players[1].calls.some(c => c[0] === 'play'), true);
  session.reset(); assert.equal(players[0].current, 12.345); assert.equal(players[1].current, 34.567);
  session.setStart(1, 30); assert.equal(session.slots[1].start, 30);
});

test('stale async loads and callbacks cannot take over a replacement video', async () => {
  const session = new ComparisonSession();
  let resolve;
  const older = adapter({ ready: new Promise(r => resolve = r) });
  const oldToken = session.begin(0, yt()); const oldAttach = session.attach(0, oldToken, older);
  const newToken = session.begin(0, vod()); const newer = adapter(); await session.attach(0, newToken, newer);
  resolve(); await oldAttach;
  session.state(0, oldToken, 'playing'); session.fail(0, oldToken, 'old error');
  assert.equal(session.slots[0].adapter, newer); assert.equal(session.slots[0].error, '');
  assert.equal(session.slots[0].ready, true); assert.equal(older.calls.at(-1)[0], 'destroy');
  const lateAdapter = adapter(); await session.attach(0, oldToken, lateAdapter); assert.equal(lateAdapter.calls.at(-1)[0], 'destroy');
});

test('player errors pause the other run and late provider states cannot hide the error', async () => {
  const { session, players } = await loadedPair();
  session.toggle(); session.state(0, session.slots[0].token, 'playing'); session.state(1, session.slots[1].token, 'playing');
  session.fail(0, session.slots[0].token, 'Embedding disabled');
  session.state(0, session.slots[0].token, 'ready');
  assert.equal(session.canPlay, true); assert.equal(session.active, false);
  assert.equal(players[1].calls.at(-1)[0], 'pause'); assert.equal(session.slots[0].status, 'error');
});

test('X and Twitter post aliases preserve the exact post ID and enable shared playback', () => {
  const id = '1987654321098765432';
  for (const url of [`https://x.com/runner/status/${id}`, `https://twitter.com/runner/status/${id}/video/1?s=20`, `https://x.com/i/web/status/${id}`, `https://mobile.twitter.com/runner/status/${id}`]) {
    const source = parseVideoUrl(url);
    assert.equal(source.id, id); assert.equal(source.kind, 'x-post'); assert.equal(source.control, true); assert.equal(source.seekable, true);
  }
  assert.throws(() => parseVideoUrl('https://x.com/runner'), /full X post link/);
});

test('direct X MP4 links retain their full URL and enable all shared controls', () => {
  const url = 'https://video.twimg.com/ext_tw_video/123/pu/vid/1280x720/run.mp4?tag=12';
  const source = parseVideoUrl(url);
  assert.equal(source.kind, 'x-video'); assert.equal(source.url, url); assert.equal(source.control, true); assert.equal(source.seekable, true);
  assert.throws(() => parseVideoUrl('https://video.twimg.com/run.m3u8'), /MP4/);
  assert.throws(() => parseVideoUrl('http://video.twimg.com/run.mp4'), /HTTPS/);
  assert.throws(() => parseVideoUrl('https://video.twimg.com.evil.test/run.mp4'));
});

test('an initialization pause cannot cancel a newly requested pair of play commands', async () => {
  const { session, players } = await loadedPair([vod(), vod()]);
  players[0].play = () => { players[0].calls.push(['play']); session.state(0, session.slots[0].token, 'paused'); };
  session.toggle();
  assert.equal(players[1].calls.some(c => c[0] === 'play'), true); assert.equal(session.intent, true);
  session.state(0, session.slots[0].token, 'playing'); session.state(1, session.slots[1].token, 'playing');
  session.toggle(); assert.equal(session.active, false);
});

test('keyboard shortcuts work after toolbar buttons are focused without stealing text entry', () => {
  const context = { canPlay: true, canReset: true, active: false };
  assert.equal(shortcutAction({ code: 'Space', key: ' ', target: { tagName: 'BUTTON', type: 'button' } }, context), 'toggle');
  assert.equal(shortcutAction({ key: 'r', target: { tagName: 'BUTTON' } }, context), 'reset');
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'VIDEO', 'IFRAME']) assert.equal(shortcutAction({ code: 'Space', key: ' ', target: { tagName } }, context), null);
  assert.equal(shortcutAction({ code: 'Space', key: ' ', target: { tagName: 'BUTTON', dataset: { nativeSpace: 'true' } } }, context), null);
  assert.equal(shortcutAction({ key: 'r', ctrlKey: true }, context), null);
});

test('a delayed Twitch response keeps the pair active and accepts a late start', async () => {
  const { session, players } = await loadedPair([vod(), yt()]);
  session.toggle();
  session.state(0, session.slots[0].token, 'starting');
  session.state(1, session.slots[1].token, 'playing');
  session.state(0, session.slots[0].token, 'waiting');
  assert.equal(session.active, true);
  assert.equal(session.slots[0].pendingPlay, true);
  assert.equal(players[1].calls.at(-1)[0], 'play');
  session.state(0, session.slots[0].token, 'paused');
  assert.equal(session.slots[0].status, 'waiting');
  session.state(0, session.slots[0].token, 'playing');
  assert.equal(session.slots[0].status, 'playing');
  assert.equal(session.slots[0].pendingPlay, false);
  session.pause();
  assert.equal(players[0].calls.at(-1)[0], 'pause');
  assert.equal(players[1].calls.at(-1)[0], 'pause');
});

test('synchronous playback rejection does not start the second video alone', async () => {
  const { session, players } = await loadedPair();
  players[0].play = () => session.state(0, session.slots[0].token, 'blocked');
  session.toggle();
  assert.equal(session.active, false); assert.equal(session.slots[0].status, 'blocked');
  assert.equal(players[1].calls.some(c => c[0] === 'play'), false);
  session.state(0, session.slots[0].token, 'paused');
  assert.equal(session.slots[0].status, 'blocked');
});

test('speed and audio commands follow capabilities and requested source', async () => {
  const { session, players } = await loadedPair();
  session.setRate(0, 0.5); assert.deepEqual(players[0].calls.at(-1), ['rate', 0.5]);
  session.setRate(1, 0.5); assert.equal(players[1].calls.some(c => c[0] === 'rate'), false);
  session.setAudio('b'); assert.deepEqual(players[0].calls.at(-1), ['mute', true]); assert.deepEqual(players[1].calls.at(-1), ['mute', false]);
  const snapshot = session.snapshot(); assert.equal(snapshot.slots[0].start, 12.345); assert.equal(snapshot.audio, 'b');
  session.clear(); assert.equal(session.canPlay, false); assert.equal(session.slots[0].source, null); assert.equal(players[0].calls.at(-1)[0], 'destroy');
});


test('Twitch recordings start directly from the shared button without native-player activation', async () => {
  const { session, players } = await loadedPair([vod(), parseVideoUrl('https://clips.twitch.tv/HelpfulClipSlug')], [10, 20]);
  assert.equal(session.canPlay, true);
  session.toggle();
  assert.equal(players[0].calls.at(-1)[0], 'play'); assert.equal(players[1].calls.at(-1)[0], 'play');
  session.state(0, session.slots[0].token, 'playing'); session.state(1, session.slots[1].token, 'playing');
  assert.equal(session.active, true);
  session.reset(); assert.equal(players[0].current, 10); assert.equal(players[1].current, 20);
});
