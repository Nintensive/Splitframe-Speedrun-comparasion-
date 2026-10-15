export const MAX_START = 600;
export const FPS_OPTIONS = [24, 25, 30, 50, 60, 120];

export function parseTime(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (/^\d+:\d{1,2}(?:\.\d+)?$/.test(text)) {
    const [m, s] = text.split(':').map(Number);
    if (s < 60) return m * 60 + s;
  }
  if (/^\d+:\d{1,2}:\d{1,2}(?:\.\d+)?$/.test(text)) {
    const [h, m, s] = text.split(':').map(Number);
    if (m < 60 && s < 60) return h * 3600 + m * 60 + s;
  }
  const units = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/);
  if (text && units) return Number(units[1] || 0) * 3600 + Number(units[2] || 0) * 60 + Number(units[3] || 0);
  return null;
}

export function formatTime(value, milliseconds = true) {
  const total = Math.round(Math.max(0, Number(value) || 0) * 1000);
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor(total / 60000) % 60;
  const seconds = Math.floor(total / 1000) % 60;
  const base = `${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return milliseconds ? `${base}.${String(total % 1000).padStart(3, '0')}` : base;
}

export function clampStart(value, duration = Infinity) {
  const limit = Number.isFinite(duration) && duration > 0 ? Math.min(MAX_START, Math.max(0, duration - 0.001)) : MAX_START;
  return Math.min(limit, Math.max(0, Number.isFinite(value) ? value : 0));
}

function linkTime(url) {
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const raw = url.searchParams.get('t') ?? url.searchParams.get('start') ?? url.searchParams.get('time') ?? hash.get('t') ?? hash.get('start');
  const parsed = raw === null ? 0 : parseTime(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseVideoUrl(input) {
  let raw = String(input ?? '').trim();
  if (!raw) throw new Error('Paste a YouTube, Twitch VOD, or X video link first.');
  if (!/^[a-z][a-z\d+.-]*:/i.test(raw)) raw = `https://${raw}`;
  let url;
  try { url = new URL(raw); } catch { throw new Error('That link looks incomplete. Copy the full video link and try again.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('Use a regular YouTube, Twitch, or X link.');
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.split('/').filter(Boolean);
  const requestedStart = linkTime(url);
  const common = { start: clampStart(requestedStart), clamped: requestedStart > MAX_START };
  if (host === 'video.twimg.com') {
    if (url.protocol !== 'https:' || !/\.mp4$/i.test(url.pathname)) throw new Error('Use a direct HTTPS MP4 video link from X, or paste the X post link.');
    return { ...common, kind: 'x-video', id: '', label: 'X video · MP4', url: url.href, control: true, seekable: true };
  }
  if (['x.com', 'twitter.com', 'm.twitter.com', 'mobile.twitter.com'].includes(host)) {
    const match = url.pathname.match(/^\/(?:[a-z\d_]{1,15}\/status|i\/web\/status|i\/status)\/(\d+)(?:\/(?:video|photo)\/(\d+))?\/?$/i);
    if (!match) throw new Error('Paste a full X post link that contains a video, such as x.com/runner/status/123456789.');
    const mediaIndex = Math.max(0, Number(match[2] || 1) - 1);
    return { ...common, kind: 'x-post', id: match[1], mediaIndex, label: 'X video', url: `https://x.com/i/web/status/${match[1]}${mediaIndex ? `/video/${mediaIndex + 1}` : ''}`, control: true, seekable: true };
  }
  const ytHosts = ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'];
  if (host === 'youtu.be' || ytHosts.includes(host)) {
    const id = host === 'youtu.be' ? path[0] : path[0] === 'watch' ? url.searchParams.get('v') : ['embed', 'shorts', 'live', 'v'].includes(path[0]) ? path[1] : null;
    if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('Use a YouTube video link, rather than a channel, playlist, or clip link.');
    return { ...common, kind: 'youtube', id, label: 'YouTube', url: `https://www.youtube.com/watch?v=${id}`, control: true, seekable: true };
  }
  if (['twitch.tv', 'm.twitch.tv', 'player.twitch.tv', 'clips.twitch.tv'].includes(host)) {
    let kind, id;
    if (host === 'clips.twitch.tv') {
      kind = 'twitch-clip'; id = path[0] === 'embed' ? url.searchParams.get('clip') : path[0];
    } else if (host === 'player.twitch.tv') {
      if (url.searchParams.has('video')) { kind = 'twitch-vod'; id = url.searchParams.get('video').replace(/^v/, ''); }
      else if (url.searchParams.has('channel')) throw new Error('Twitch live streams aren’t supported. Paste a recorded VOD link from twitch.tv/videos/… instead.');
    } else if (path[0] === 'videos') { kind = 'twitch-vod'; id = path[1]; }
    else if (path.length === 3 && path[1] === 'clip') { kind = 'twitch-clip'; id = path[2]; }
    else if (path.length === 3 && path[1] === 'v') { kind = 'twitch-vod'; id = path[2]; }
    if (kind === 'twitch-vod' && /^\d+$/.test(id || '')) return { ...common, kind, id, label: 'Twitch VOD', url: `https://www.twitch.tv/videos/${id}`, control: true, seekable: true };
    if (kind === 'twitch-clip' && /^[\w-]{3,200}$/.test(id || '')) return { ...common, start: 0, kind, id, label: 'Twitch clip', url: `https://clips.twitch.tv/${id}`, control: false, seekable: false };
    const reserved = ['directory', 'downloads', 'videos', 'settings', 'subscriptions', 'clips', 'payments', 'inventory', 'login', 'signup', 'search', 'jobs', 'p', 'legal', 'collections', 'wallet', 'turbo'];
    if (path.length === 1 && /^[a-z\d_]{1,25}$/i.test(path[0]) && !reserved.includes(path[0].toLowerCase())) throw new Error('Twitch live streams aren’t supported. Paste a recorded VOD link from twitch.tv/videos/… instead.');
    throw new Error('Use a Twitch VOD or clip link. Live streams, collections, and directory links aren’t supported.');
  }
  throw new Error('Paste a YouTube, Twitch VOD, or X video link, or use Choose video for a local file.');
}

export function shortcutAction(event, { canPlay = false, canReset = false, active = false } = {}) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return null;
  const target = event.target;
  if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT|VIDEO|IFRAME)$/.test(target?.tagName || '')) return null;
  if (String(event.key).toLowerCase() === 'r' && canReset) return 'reset';
  if (event.code !== 'Space' || (!canPlay && !active)) return null;
  if (/^(A|SUMMARY)$/.test(target?.tagName || '') || target?.type === 'submit' || target?.dataset?.nativeSpace === 'true') return null;
  return 'toggle';
}

export function emptySlot() {
  return { source: null, adapter: null, token: 0, status: 'empty', start: 0, fps: 60, rate: 1, error: '', ready: false, mounted: false, pendingPlay: false, activated: true };
}

export function localVideoSource(file) {
  const name = typeof file?.name === 'string' ? file.name : '';
  if (!name || !Number.isFinite(file.size) || file.size <= 0) throw new Error('Choose a video file that isn’t empty.');
  if (!String(file.type || '').startsWith('video/') && !/\.(mp4|webm|mov|m4v|ogv|ogg|mkv|avi|mpeg|mpg|mts|m2ts|ts|wmv|flv|3gp)$/i.test(name)) {
    throw new Error('Choose a video file, such as MP4 or WebM.');
  }
  return { kind: 'local', id: '', label: 'Local video', url: '', filename: name, fileSize: file.size, mimeType: String(file.type || ''), lastModified: Number(file.lastModified) || 0, start: 0, control: true, seekable: true };
}

/** Coordinates player commands without assuming both networks start at the same instant. */
export class ComparisonSession {
  constructor(onChange = () => {}) {
    this.slots = [emptySlot(), emptySlot()];
    this.onChange = onChange;
    this.intent = false;
    this.audio = 'mute';
  }
  notify() { this.onChange(this); }
  get controlledSlots() { return this.slots.filter(s => s.ready && s.source?.control && !['error', 'offline', 'loading'].includes(s.status)); }
  get activationSlots() { return this.controlledSlots.filter(s => !s.activated); }
  get canPlay() { return this.controlledSlots.length > 0 && this.activationSlots.length === 0; }
  get canReset() { return this.controlledSlots.some(s => s.source.seekable); }
  get active() { return this.intent || this.slots.some(s => ['playing', 'buffering'].includes(s.status)); }
  begin(index, source, preferences = {}) {
    this.pause();
    const previous = this.slots[index];
    previous.adapter?.destroy();
    const slot = { ...emptySlot(), source, token: previous.token + 1, activated: source.kind !== 'twitch-vod', status: 'loading', start: clampStart(preferences.start ?? source.start), fps: FPS_OPTIONS.includes(preferences.fps) ? preferences.fps : 60 };
    if (!source.seekable) slot.start = 0;
    this.slots[index] = slot;
    this.notify();
    return slot.token;
  }
  isCurrent(index, token) { return this.slots[index].token === token; }
  async attach(index, token, adapter) {
    if (!this.isCurrent(index, token)) { adapter.destroy(); return; }
    this.slots[index].adapter = adapter;
    try {
      await adapter.ready;
      if (!this.isCurrent(index, token)) return;
      const slot = this.slots[index];
      slot.ready = true;
      if (!['error', 'offline'].includes(slot.status)) slot.status = !slot.activated ? 'activate' : slot.source.control ? 'ready' : 'manual';
      slot.start = clampStart(slot.start, adapter.duration());
      this.applyAudio();
      if (slot.source.seekable && slot.start > 0) adapter.seek(slot.start);
      adapter.pause();
      this.notify();
    } catch (error) {
      this.fail(index, token, error.message || 'This player could not load. Try loading it again.');
    }
  }
  state(index, token, status) {
    if (!this.isCurrent(index, token)) return;
    if (this.slots[index].status === 'error') return;
    const slot = this.slots[index];
    if (!slot.activated && status === 'playing') {
      // A real first playback confirms Twitch accepted the user's in-frame
      // gesture. Pause at the saved start before linking the comparison.
      slot.activated = true;
      this.pause();
      if (slot.ready) {
        slot.adapter.seek(clampStart(slot.start, slot.adapter.duration()));
        slot.adapter.pause();
      }
      slot.status = 'paused';
      this.notify();
      return;
    }
    if (['blocked', 'needs-click'].includes(this.slots[index].status) && ['paused', 'ready'].includes(status)) return;
    // SDKs can deliver an earlier initialization pause after a new play command.
    if (this.slots[index].pendingPlay && ['paused', 'ready'].includes(status)) return;
    if (['playing', 'ended', 'blocked', 'needs-click', 'offline', 'error'].includes(status)) this.slots[index].pendingPlay = false;
    this.slots[index].status = status;
    if (['blocked', 'needs-click', 'offline', 'error'].includes(status)) {
      this.pause();
      this.slots[index].status = status;
    }
    if (['paused', 'ended'].includes(status) && !this.slots.some(s => ['playing', 'buffering'].includes(s.status))) this.intent = false;
    this.notify();
  }
  fail(index, token, message) {
    if (!this.isCurrent(index, token)) return;
    this.pause();
    Object.assign(this.slots[index], { status: 'error', error: message, ready: false });
    this.notify();
  }
  pause() {
    this.intent = false;
    for (const slot of this.slots) {
      slot.pendingPlay = false;
      if (slot.ready && slot.source?.control) {
        try { slot.adapter.pause(); } catch { /* Player can disappear during navigation. */ }
        if (['playing', 'buffering', 'starting', 'waiting'].includes(slot.status)) slot.status = 'paused';
      }
    }
    this.notify();
  }
  toggle() {
    if (this.active) { this.pause(); return; }
    if (!this.canPlay) return;
    this.intent = true;
    const targets = this.controlledSlots;
    for (const slot of targets) slot.pendingPlay = true;
    this.notify();
    for (const slot of targets) {
      if (!this.intent) break;
      try { slot.adapter.play(); } catch (error) { this.fail(this.slots.indexOf(slot), slot.token, error.message); break; }
    }
  }
  reset() {
    if (!this.canReset) return;
    this.pause();
    for (const slot of this.controlledSlots.filter(s => s.source.seekable)) {
      slot.start = clampStart(slot.start, slot.adapter.duration());
      slot.adapter.seek(slot.start);
      slot.adapter.pause();
    }
    this.notify();
  }
  setStart(index, value) {
    const slot = this.slots[index];
    if (slot.source && !slot.source.seekable) return;
    this.pause();
    slot.start = clampStart(value, slot.ready ? slot.adapter.duration() : Infinity);
    if (slot.ready) {
      slot.adapter.seek(slot.start);
      slot.adapter.pause();
    }
    this.notify();
  }
  nudge(index, amount, frames = false) {
    const slot = this.slots[index];
    this.setStart(index, slot.start + (frames ? amount / slot.fps : amount));
  }
  setFPS(index, fps) {
    if (FPS_OPTIONS.includes(fps)) this.slots[index].fps = fps;
    this.notify();
  }
  setRate(index, rate) {
    const slot = this.slots[index];
    if (!slot.ready || !slot.adapter.rates().includes(rate)) return;
    slot.adapter.setRate(rate);
  }
  setAudio(audio) {
    if (['mute', 'a', 'b', 'both'].includes(audio)) this.audio = audio;
    this.applyAudio();
    this.notify();
  }
  applyAudio() {
    this.slots.forEach((slot, index) => {
      if (slot.ready && slot.source?.control) slot.adapter.mute(!(this.audio === 'both' || this.audio === (index === 0 ? 'a' : 'b')));
    });
  }
  clear() {
    this.pause();
    this.slots = this.slots.map(slot => {
      slot.adapter?.destroy();
      return { ...emptySlot(), token: slot.token + 1 };
    });
    this.audio = 'mute';
    this.notify();
  }
  snapshot() {
    return { version: 1, audio: this.audio, slots: this.slots.map(s => ({
      url: s.source?.url || '', start: s.start, fps: s.fps,
      ...(s.source?.kind === 'local' ? { localFile: { name: s.source.filename, size: s.source.fileSize, type: s.source.mimeType, lastModified: s.source.lastModified } } : {})
    })) };
  }
}
