import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer, twitchParents, youtubeError } from '../dist/players.js';
import { ComparisonSession, parseVideoUrl, shortcutAction } from '../dist/core.js';

// SDK-contract doubles test emitted commands and events without claiming network playback.
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.isConnected = true; this.attributes = {}; }
  replaceChildren(...items) { this.children.forEach(c => c.remove()); this.children = items; for (const item of items) item.parent = this; }
  replaceWith(item) { const i = this.parent?.children.indexOf(this); if (i >= 0) { this.parent.children[i] = item; item.parent = this.parent; } this.isConnected = false; }
  remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(item) { this.children.push(item); item.parent = this; }
  querySelector(tag) { return this.children.find(child => child.tagName === tag) || null; }
}

function environment() {
  const win = { location: { hostname: 'compare.example', origin: 'https://compare.example', ancestorOrigins: [] } };
  win.self = win; win.top = win;
  globalThis.window = win;
  globalThis.document = { created: [], createElement(tag) { const element = new Element(tag); this.created.push(element); return element; }, head: new Element('head'), referrer: '' };
  return win;
}

async function twitchFixture(callbacks = {}, { duration = 1800 } = {}) {
  const win = environment(); let raw, options;
  class TwitchPlayer {
    static instances = [];
    static READY = 'ready'; static VIDEO_READY = 'video.ready'; static PLAY = 'play'; static PLAYING = 'playing'; static PAUSE = 'pause'; static ENDED = 'ended'; static ERROR = 'error'; static PLAYBACK_BLOCKED = 'blocked';
    constructor(id, config) {
      raw = this; options = config; this.listeners = {}; this.calls = []; this.duration = duration; this.paused = true; this.current = 0;
      TwitchPlayer.instances.push(this);
      this.iframe = new Element('iframe'); document.created.find(el => el.id === id).append(this.iframe);
    }
    addEventListener(name, callback) {
      this.listeners[name] = data => {
        if (['play', 'playing'].includes(name)) this.paused = false;
        if (['pause', 'blocked'].includes(name)) this.paused = true;
        callback(data);
      };
    }
    play() { this.calls.push(['play']); this.onPlay?.(); }
    pause() { this.paused = true; this.calls.push(['pause']); }
    seek(value) { this.calls.push(['seek', value]); }
    setMuted(value) { this.muted = value; this.calls.push(['mute', value]); }
    getCurrentTime() { return this.current; }
    isPaused() { return this.paused; }
    getEnded() { return Boolean(this.ended); }
    getDuration() { return this.duration; }
  }
  win.Twitch = { Player: TwitchPlayer };
  const source = parseVideoUrl('https://www.twitch.tv/videos/2899330847');
  const adapter = await createPlayer(new Element(), source, callbacks);
  return { adapter, raw, options, source, TwitchPlayer };
}

test('Twitch parent domains include the current host and every known iframe ancestor once', () => {
  assert.deepEqual(twitchParents({ hostname: 'compare.example' }, ['https://chatgpt.com', 'https://chatgpt.com', 'opaque'], 'https://shell.example/view', true), ['compare.example', 'chatgpt.com', 'shell.example']);
  assert.deepEqual(twitchParents({ hostname: 'localhost' }, [], 'https://unrelated.example', false), ['localhost']);
});

test('YouTube embeds identify the origin, map fractional seeking and use actual rate events', async () => {
  const win = environment(); let options; let raw;
  win.YT = { Player: class {
    constructor(id, config) { options = config; raw = this; this.iframe = new Element('iframe'); this.calls = []; }
    mute() { this.calls.push(['mute']); } unMute() { this.calls.push(['unmute']); }
    getIframe() { return this.iframe; } playVideo() { this.calls.push(['play']); } pauseVideo() { this.calls.push(['pause']); }
    seekTo(time, allow) { this.calls.push(['seek', time, allow]); }
    getCurrentTime() { return 42.125; } getDuration() { return 1200; }
    getAvailablePlaybackRates() { return [0.5, 1, 2]; } setPlaybackRate(value) { this.calls.push(['rate', value]); }
    destroy() { this.calls.push(['destroy']); }
  } };
  const states = [], rates = [], errors = [];
  const adapter = await createPlayer(new Element(), parseVideoUrl('https://youtu.be/M7lc1UVf-VE'), { start: 12.75, onState: s => states.push(s), onRate: r => rates.push(r), onError: e => errors.push(e) });
  assert.equal(options.playerVars.origin, 'https://compare.example'); assert.equal(options.playerVars.autoplay, 0);
  options.events.onReady({ target: raw }); await adapter.ready;
  assert.equal(raw.iframe.referrerPolicy, 'strict-origin-when-cross-origin');
  adapter.play(); adapter.pause(); adapter.seek(12.75); adapter.setRate(0.5);
  assert.deepEqual(raw.calls.slice(-4), [['play'], ['pause'], ['seek', 12.75, true], ['rate', 0.5]]);
  assert.equal(adapter.time(), 42.125); assert.deepEqual(adapter.rates(), [0.5, 1, 2]);
  options.events.onStateChange({ data: 3 }); options.events.onStateChange({ data: 1 }); options.events.onPlaybackRateChange({ data: 0.5 }); options.events.onAutoplayBlocked();
  assert.deepEqual(states, ['buffering', 'playing', 'blocked']); assert.deepEqual(rates, [0.5]);
  options.events.onError({ data: 101 }); assert.match(errors.at(-1), /disabled embedding/);
  adapter.destroy(); options.events.onStateChange({ data: 1 }); assert.equal(states.length, 3);
});

test('Twitch VOD embeds send documented play/pause/seek APIs and map readiness and blocking', async () => {
  const win = environment(); let options; let raw;
  const mount = new Element(); mount.hidden = true;
  class TwitchPlayer {
    static READY = 'ready'; static VIDEO_READY = 'video.ready'; static PLAY = 'play'; static PLAYING = 'playing'; static PAUSE = 'pause'; static ENDED = 'ended'; static ERROR = 'error'; static PLAYBACK_BLOCKED = 'blocked';
    constructor(id, config) {
      assert.equal(mount.hidden, false, 'Twitch must initialize in a visible mount');
      options = config; raw = this; this.listeners = {}; this.calls = [];
      this.iframe = new Element('iframe'); document.created.find(el => el.id === id).append(this.iframe);
    }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    play() { this.calls.push(['play']); } pause() { this.calls.push(['pause']); }
    seek(value) { this.calls.push(['seek', value]); } setMuted(value) { this.calls.push(['mute', value]); }
    getCurrentTime() { return 30.25; } getDuration() { return 1800; }
  }
  win.Twitch = { Player: TwitchPlayer };
  const states = [];
  const adapter = await createPlayer(mount, parseVideoUrl('https://twitch.tv/videos/123'), { start: 12.75, onState: s => states.push(s), onMount: () => { mount.hidden = false; } });
  assert.equal(options.video, 'v123'); assert.deepEqual(options.parent, ['compare.example']); assert.equal(options.autoplay, false); assert.equal(options.muted, true);
  raw.listeners['video.ready'](); await adapter.ready;
  assert.match(raw.iframe.attributes.allow, /autoplay/); assert.equal(raw.iframe.title, 'Twitch VOD player');
  assert.equal('channel' in options, false);
  adapter.play(); adapter.pause(); adapter.seek(12.75); adapter.mute(false);
  assert.deepEqual(raw.calls, [['mute', true], ['play'], ['pause'], ['seek', 12.75], ['mute', false]]);
  raw.listeners.playing(); raw.listeners.blocked();
  assert.deepEqual(states, ['starting', 'playing', 'blocked']); assert.deepEqual(adapter.rates(), []);
  assert.equal(adapter.time(), 30.25); adapter.destroy(); assert.equal(mount.children.length, 0);
  raw.listeners.playing(); assert.equal(states.length, 3);
});

test('Twitch VOD controls wait for metadata after the SDK readiness event', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { adapter, raw, options } = await twitchFixture({}, { duration: 0 });
  t.after(() => adapter.destroy());
  let usable = false;
  adapter.ready.then(() => { usable = true; });
  raw.listeners.ready();
  await Promise.resolve();
  assert.equal(usable, false, 'READY alone must not enable controls before the VOD metadata');
  raw.duration = 1200;
  t.mock.timers.tick(100);
  await adapter.ready;
  assert.equal(usable, true);
  assert.equal(options.video, 'v2899330847');
});

test('a lost first Twitch play command gets one retry without a false blocked timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const states = [];
  const { adapter, raw } = await twitchFixture({ onState: state => states.push(state) });
  t.after(() => adapter.destroy());
  raw.listeners.ready(); await adapter.ready;
  adapter.play();
  t.mock.timers.tick(1000);
  assert.equal(raw.calls.filter(call => call[0] === 'play').length, 2);
  t.mock.timers.tick(30000);
  assert.equal(raw.calls.filter(call => call[0] === 'play').length, 2, 'retry is bounded');
  assert.equal(raw.calls.some(call => call[0] === 'pause'), false);
  assert.equal(states.includes('blocked'), false);
  raw.listeners.playing();
  assert.equal(states.at(-1), 'playing');
});

test('Twitch buffering can exceed seven seconds without pausing either video', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const states = [];
  const { adapter, raw } = await twitchFixture({ onState: state => states.push(state) });
  t.after(() => adapter.destroy());
  raw.listeners.ready(); await adapter.ready;
  adapter.play(); raw.listeners.play();
  t.mock.timers.tick(15000);
  assert.equal(raw.calls.filter(call => call[0] === 'play').length, 1);
  assert.equal(raw.calls.some(call => call[0] === 'pause'), false);
  assert.equal(states.includes('blocked'), false);
});

test('an unanswered Twitch Play request reports a native activation step when the SDK confirms it stayed paused', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const states = [];
  const { adapter, raw } = await twitchFixture({ onState: state => states.push(state) });
  t.after(() => adapter.destroy());
  raw.listeners.ready(); await adapter.ready;
  adapter.play();
  assert.equal(states.at(-1), 'starting', 'sending a command is not evidence of buffering');
  t.mock.timers.tick(8000);
  assert.equal(states.at(-1), 'needs-click');
  assert.equal(states.includes('buffering'), false);
  assert.equal(states.includes('blocked'), false);
  raw.listeners.playing();
  assert.equal(states.at(-1), 'playing');
});

test('an unpaused Twitch startup without events keeps waiting rather than forcibly stopping a slow buffer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const states = [];
  const { adapter, raw } = await twitchFixture({ onState: state => states.push(state) });
  t.after(() => adapter.destroy());
  raw.listeners.ready(); await adapter.ready;
  adapter.play(); raw.paused = false;
  t.mock.timers.tick(10000);
  assert.equal(states.at(-1), 'waiting');
  assert.equal(raw.calls.some(call => call[0] === 'pause'), false);
});

test('two advancing Twitch timestamps confirm playback when PLAYING is missing, while a single seek does not', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const states = [];
  const { adapter, raw } = await twitchFixture({ onState: state => states.push(state) });
  t.after(() => adapter.destroy());
  raw.listeners.ready(); await adapter.ready;
  adapter.play(); raw.paused = false;
  raw.current = 30; t.mock.timers.tick(500);
  t.mock.timers.tick(500);
  assert.equal(states.at(-1), 'starting');
  raw.current = 30.5; t.mock.timers.tick(500);
  assert.equal(states.at(-1), 'playing');
  t.mock.timers.tick(10000);
  assert.equal(states.at(-1), 'playing');
  raw.paused = true; t.mock.timers.tick(500);
  assert.equal(states.at(-1), 'paused');
});

test('a muted retry that silently remains paused also receives the activation prompt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const states = [];
  const { adapter, raw } = await twitchFixture({ onState: state => states.push(state) });
  t.after(() => adapter.destroy());
  raw.listeners.ready(); await adapter.ready;
  adapter.mute(false); adapter.play(); raw.listeners.blocked();
  t.mock.timers.tick(8000);
  assert.equal(states.at(-1), 'needs-click');
});

test('Twitch playback polling keeps an ended VOD finished after earlier timestamps advanced', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const states = [];
  const { adapter, raw } = await twitchFixture({ onState: state => states.push(state) });
  t.after(() => adapter.destroy());
  raw.listeners.ready(); await adapter.ready;
  adapter.play(); raw.paused = false;
  raw.current = 0.5; t.mock.timers.tick(500);
  raw.current = 1; t.mock.timers.tick(500);
  assert.equal(states.at(-1), 'playing');
  raw.ended = true; raw.listeners.ended();
  t.mock.timers.tick(10000);
  assert.equal(states.at(-1), 'ended');
});

test('Twitch retries sound-blocked playback muted once and reports a genuine second rejection', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const states = []; let notices = 0;
  const { adapter, raw } = await twitchFixture({ onState: state => states.push(state), onMutedFallback: () => notices++ });
  t.after(() => adapter.destroy());
  raw.listeners.ready(); await adapter.ready;
  adapter.mute(false); adapter.play(); raw.listeners.blocked();
  assert.equal(notices, 1);
  assert.deepEqual(raw.calls.slice(-2), [['mute', true], ['play']]);
  assert.equal(states.includes('blocked'), false, 'the first sound rejection should recover');
  raw.listeners.blocked();
  assert.equal(states.at(-1), 'blocked');
  assert.equal(notices, 1);
  t.mock.timers.tick(10000);
  assert.equal(raw.calls.filter(call => call[0] === 'play').length, 2);
});

test('pausing or replacing a Twitch player cancels its pending play retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { adapter, raw } = await twitchFixture();
  t.after(() => adapter.destroy());
  raw.listeners.ready(); await adapter.ready;
  adapter.play(); adapter.pause();
  t.mock.timers.tick(5000);
  assert.equal(raw.calls.filter(call => call[0] === 'play').length, 1);
  adapter.play(); adapter.destroy();
  t.mock.timers.tick(5000);
  assert.equal(raw.calls.filter(call => call[0] === 'play').length, 2);
});

test('the reported VOD uses toolbar and keyboard commands alongside another video after muted recovery', async t => {
  const session = new ComparisonSession();
  const vod = parseVideoUrl('https://www.twitch.tv/videos/2899330847');
  const token = session.begin(0, vod, { start: 30 });
  const otherToken = session.begin(1, parseVideoUrl('https://youtu.be/M7lc1UVf-VE'), { start: 45 });
  const { adapter, raw } = await twitchFixture({
    onState: state => session.state(0, token, state),
    onMutedFallback: () => session.setAudio('mute')
  });
  t.after(() => session.clear());
  raw.listeners.ready(); await session.attach(0, token, adapter);
  const calls = [];
  const other = { ready: Promise.resolve(), duration: () => 1200, rates: () => [1], mute() {}, time: () => 0, destroy() {},
    play() { calls.push(['play']); session.state(1, otherToken, 'playing'); }, pause() { calls.push(['pause']); }, seek: value => calls.push(['seek', value]) };
  await session.attach(1, otherToken, other);
  session.setAudio('both');
  raw.onPlay = () => { if (raw.muted) raw.listeners.playing(); else raw.listeners.blocked(); };
  session.toggle();
  assert.equal(session.audio, 'mute');
  assert.equal(session.slots[0].status, 'playing');
  assert.equal(session.slots[1].status, 'playing');
  assert.equal(calls.at(-1)[0], 'play');
  const action = shortcutAction({ code: 'Space', key: ' ', target: { tagName: 'BUTTON', type: 'button' } }, session);
  assert.equal(action, 'toggle'); session[action]();
  assert.equal(session.active, false); assert.equal(raw.calls.at(-1)[0], 'pause'); assert.equal(calls.at(-1)[0], 'pause');
  session.toggle(); assert.equal(session.slots[0].status, 'playing');
  session.reset();
  assert.deepEqual(raw.calls.slice(-2), [['seek', 30], ['pause']]);
  assert.deepEqual(calls.slice(-2), [['seek', 45], ['pause']]);
});

test('two Twitch VODs both recover when sound rejections arrive after the first player mutes the pair', async t => {
  const session = new ComparisonSession();
  const source = parseVideoUrl('https://www.twitch.tv/videos/2899330847');
  const tokens = [session.begin(0, source), session.begin(1, source)];
  const callbacks = index => ({ onState: state => session.state(index, tokens[index], state), onMutedFallback: () => session.setAudio('mute') });
  const first = await twitchFixture(callbacks(0));
  const secondAdapter = await createPlayer(new Element(), source, callbacks(1));
  const second = first.TwitchPlayer.instances[1];
  t.after(() => session.clear());
  first.raw.listeners.ready(); second.listeners.ready();
  await session.attach(0, tokens[0], first.adapter);
  await session.attach(1, tokens[1], secondAdapter);
  session.setAudio('both');
  session.toggle();
  first.raw.onPlay = () => first.raw.listeners.playing();
  second.onPlay = () => second.listeners.playing();
  first.raw.listeners.blocked();
  assert.equal(session.audio, 'mute');
  assert.equal(second.muted, true);
  second.listeners.blocked();
  assert.equal(session.active, true);
  assert.deepEqual(session.slots.map(slot => slot.status), ['playing', 'playing']);
  assert.equal(second.calls.filter(call => call[0] === 'play').length, 2);
});

test('X posts use the official dark widget and wait until the post is rendered', async () => {
  const win = environment(); const mount = new Element(); let received;
  win.twttr = { ready: callback => callback(), widgets: { createTweet(id, parent, options) {
    received = { id, options }; const widget = new Element('iframe'); parent.append(widget); return Promise.resolve(widget);
  } } };
  const adapter = await createPlayer(mount, parseVideoUrl('https://x.com/runner/status/1987654321098765432'));
  await adapter.ready;
  assert.equal(received.id, '1987654321098765432'); assert.equal(received.options.theme, 'dark'); assert.equal(received.options.dnt, true);
  assert.deepEqual(adapter.rates(), []); adapter.destroy(); assert.equal(mount.children.length, 0);
});

test('a missing or restricted X post reports an error instead of claiming to be loaded', async () => {
  const win = environment(); const errors = [];
  win.twttr = { widgets: { createTweet: () => Promise.resolve(undefined) } };
  const adapter = await createPlayer(new Element(), parseVideoUrl('https://x.com/runner/status/123'), { onError: message => errors.push(message) });
  await assert.rejects(adapter.ready, /could not be embedded/);
  assert.match(errors[0], /private, deleted, or restricted/); adapter.destroy();
});

test('Twitch clip frames use the correct embed URL and require native controls', async () => {
  environment(); const mount = new Element();
  const adapter = await createPlayer(mount, parseVideoUrl('https://clips.twitch.tv/HelpfulClip-Slug'));
  await adapter.ready;
  const iframe = mount.children[0]; const url = new URL(iframe.src);
  assert.equal(url.hostname, 'clips.twitch.tv'); assert.equal(url.pathname, '/embed');
  assert.equal(url.searchParams.get('clip'), 'HelpfulClip-Slug'); assert.equal(url.searchParams.get('parent'), 'compare.example');
  assert.equal(url.searchParams.get('autoplay'), 'false'); assert.equal(iframe.allowFullscreen, true);
  assert.deepEqual(adapter.rates(), []); adapter.destroy(); assert.equal(mount.children.length, 0);
});

test('deleted videos and referrer errors receive specific recovery messages', () => {
  assert.match(youtubeError(100), /private, deleted/); assert.match(youtubeError(153), /own tab/);
  assert.match(youtubeError(150), /disabled embedding/); assert.match(youtubeError(999), /Try again/);
});
