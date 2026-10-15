import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer, twitchParents, youtubeError } from '../web/players.js';
import { ComparisonSession, parseVideoUrl, shortcutAction } from '../web/core.js';

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

test('deleted videos and referrer errors receive specific recovery messages', () => {
  assert.match(youtubeError(100), /private, deleted/); assert.match(youtubeError(153), /own tab/);
  assert.match(youtubeError(150), /disabled embedding/); assert.match(youtubeError(999), /Try again/);
});
