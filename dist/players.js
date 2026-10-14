const sdkPromises = new Map();

function sdk(name) {
  const w = window;
  const available = () => name === 'youtube' ? w.YT?.Player : name === 'x' ? w.twttr?.widgets?.createTweet : w.Twitch?.Player;
  if (available()) return name === 'x' && typeof w.twttr.ready === 'function' ? new Promise(resolve => w.twttr.ready(resolve)) : Promise.resolve();
  if (sdkPromises.has(name)) return sdkPromises.get(name);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const label = name === 'youtube' ? 'YouTube' : name === 'x' ? 'X' : 'Twitch';
    script.src = name === 'youtube' ? 'https://www.youtube.com/iframe_api' : name === 'x' ? 'https://platform.twitter.com/widgets.js' : 'https://player.twitch.tv/js/embed/v1.js';
    script.async = true;
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(poll);
      if (error) { script.remove(); reject(error); } else resolve();
    };
    const timeout = setTimeout(() => finish(new Error(`${label} took too long to respond. Check your connection or content blocker, then press Load again.`)), 18000);
    const poll = setInterval(() => { if (name !== 'x' && available()) finish(); }, 100);
    if (name === 'x') {
      if (!w.twttr) w.twttr = { _e: [], ready(callback) { this._e.push(callback); } };
      w.twttr.ready(() => finish());
    }
    if (name === 'youtube') {
      const previousReady = w.onYouTubeIframeAPIReady;
      w.onYouTubeIframeAPIReady = () => {
        if (typeof previousReady === 'function') previousReady();
        if (available()) finish();
      };
    }
    script.onerror = () => finish(new Error(`Couldn’t reach ${label}. Check your connection or content blocker, then press Load again.`));
    script.onload = () => { if (name !== 'x' && available()) finish(); };
    document.head.append(script);
  });
  sdkPromises.set(name, promise);
  promise.catch(() => sdkPromises.delete(name));
  return promise;
}

export function twitchParents(location, ancestors = [], referrer = '', framed = false) {
  const names = [location.hostname];
  for (const origin of ancestors) {
    try { names.push(new URL(origin).hostname); } catch { /* Ignore opaque ancestor origins. */ }
  }
  if (framed && referrer) {
    try { names.push(new URL(referrer).hostname); } catch { /* Referrer may be unavailable. */ }
  }
  return [...new Set(names.filter(Boolean))];
}

export function youtubeError(code) {
  return ({
    2: 'YouTube rejected this video ID. Copy the original video link and try again.',
    5: 'YouTube couldn’t play this video in your browser. Reload it or open the original.',
    100: 'This YouTube video is private, deleted, or unavailable. Try another video.',
    101: 'The video owner has disabled embedding. Choose another video or open the original.',
    150: 'The video owner has disabled embedding. Choose another video or open the original.',
    153: 'YouTube could not verify this website. Open Splitframe in its own tab and check privacy or referrer-blocking extensions.'
  })[code] || 'YouTube couldn’t load this video. Try again or open the original.';
}

export function localVideoError(code) {
  return ({
    1: 'Loading this file was interrupted. Choose the video again.',
    2: 'The browser couldn’t read this file. Check that it is still available, then choose it again.',
    3: 'The browser couldn’t decode this video. It may be damaged or use an unsupported codec. Try an MP4 or WebM version.',
    4: 'This video format or codec isn’t supported by your browser. Try an MP4 or WebM version.'
  })[code] || 'This video couldn’t be opened. Choose a different file or try an MP4 or WebM version.';
}

function createMediaPlayer(mount, mediaUrl, { label, local = false, release = () => {}, onState = () => {}, onError = () => {}, onRate = () => {}, onMount = () => {} } = {}) {
  const video = document.createElement('video');
  let disposed = false, settled = false, readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  ready.catch(() => {});
  const emit = (callback, value) => { if (!disposed) callback(value); };
  const fail = message => {
    if (disposed) return;
    clearTimeout(timeout);
    if (!settled) { settled = true; readyReject(new Error(message)); }
    emit(onError, message);
  };
  const timeout = setTimeout(() => fail(local ? 'The browser couldn’t read this video’s duration. Choose it again, or try an MP4 or WebM version.' : 'The X video did not load. Check that this is an available direct MP4 link, or open a local copy.'), 25000);
  video.controls = true;
  video.playsInline = true;
  video.muted = true;
  video.autoplay = false;
  video.preload = 'metadata';
  video.setAttribute('aria-label', label || 'Video player');
  video.addEventListener('loadedmetadata', () => {
    if (disposed || settled) return;
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      fail('This file has no usable video duration. Choose another video.');
      return;
    }
    settled = true;
    clearTimeout(timeout);
    readyResolve();
  });
  video.addEventListener('play', () => emit(onState, 'buffering'));
  video.addEventListener('playing', () => emit(onState, 'playing'));
  video.addEventListener('pause', () => emit(onState, 'paused'));
  video.addEventListener('ended', () => emit(onState, 'ended'));
  for (const event of ['waiting', 'stalled']) video.addEventListener(event, () => { if (!video.paused) emit(onState, 'buffering'); });
  video.addEventListener('ratechange', () => emit(onRate, video.playbackRate));
  video.addEventListener('error', () => fail(local ? localVideoError(video.error?.code) : 'This X MP4 is unavailable, expired, or unsupported by your browser. Check the original link, or choose a local copy.'));
  video.src = mediaUrl;
  mount.replaceChildren(video);
  onMount();
  return {
    ready,
    play() {
      try {
        const playback = video.play();
        playback?.catch(error => {
          if (disposed || error.name === 'AbortError') return;
          if (error.name === 'NotAllowedError') emit(onState, 'blocked');
          else fail(localVideoError(video.error?.code));
        });
      } catch (error) {
        if (error.name === 'NotAllowedError') emit(onState, 'blocked');
        else fail(localVideoError(video.error?.code));
      }
    },
    pause: () => video.pause(),
    seek: seconds => { video.currentTime = seconds; },
    mute: muted => { video.muted = muted; },
    time: () => video.currentTime || 0,
    duration: () => Number.isFinite(video.duration) ? video.duration : 0,
    rates: () => [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
    setRate: rate => { video.playbackRate = rate; },
    destroy() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timeout);
      if (!settled) { settled = true; readyResolve(); }
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
      release();
    }
  };
}

export function createLocalPlayer(mount, file, options = {}) {
  if (!file) throw new Error('Choose the local video again to load it.');
  const objectUrl = URL.createObjectURL(file);
  return createMediaPlayer(mount, objectUrl, { ...options, label: `Local video: ${file.name}`, local: true, release: () => URL.revokeObjectURL(objectUrl) });
}

export async function createPlayer(mount, source, { start = 0, file, onState = () => {}, onError = () => {}, onRate = () => {}, onMount = () => {}, onMutedFallback = () => {} } = {}) {
  if (source.kind === 'local') return createLocalPlayer(mount, file, { onState, onError, onRate, onMount });
  if (source.kind === 'x-video') return createMediaPlayer(mount, source.url, { label: 'X MP4 video player', onState, onError, onRate, onMount });
  let disposed = false;
  const emit = (callback, value) => { if (!disposed) callback(value); };
  const parents = twitchParents(window.location, Array.from(window.location.ancestorOrigins || []), document.referrer, window.self !== window.top);
  const inner = document.createElement('div');
  inner.id = `embed-${crypto.randomUUID()}`;
  mount.replaceChildren(inner);
  onMount();
  if (source.kind === 'x-post') {
    await sdk('x');
    if (!inner.isConnected) throw new Error('Video load was replaced.');
    let settled = false, resolveReady, rejectReady;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    ready.catch(() => {});
    const fail = message => {
      if (disposed || settled) return;
      settled = true; clearTimeout(timeout); rejectReady(new Error(message)); emit(onError, message);
    };
    const timeout = setTimeout(() => fail('X took too long to render this post. Check your connection or content blocker, then press Load again.'), 25000);
    Promise.resolve().then(() => window.twttr.widgets.createTweet(source.id, inner, { theme: 'dark', align: 'center', conversation: 'none', dnt: true })).then(widget => {
      if (disposed || settled) { widget?.remove(); return; }
      if (!widget) { fail('This X post could not be embedded. It may be private, deleted, or restricted. Open the original or choose a local copy.'); return; }
      settled = true; clearTimeout(timeout); resolveReady();
    }).catch(() => fail('X couldn’t display this post. Check the original link or choose a local copy.'));
    return { ready, play() {}, pause() {}, seek() {}, mute() {}, rates: () => [], setRate() {}, time: () => 0, duration: () => 0, destroy() { disposed = true; clearTimeout(timeout); if (!settled) { settled = true; resolveReady(); } inner.remove(); } };
  }
  if (source.kind === 'twitch-clip') {
    const iframe = document.createElement('iframe');
    const url = new URL('https://clips.twitch.tv/embed');
    url.searchParams.set('clip', source.id);
    for (const parent of parents) url.searchParams.append('parent', parent);
    url.searchParams.set('autoplay', 'false');
    url.searchParams.set('muted', 'true');
    iframe.src = url.href;
    iframe.title = 'Twitch clip — use the controls inside this player';
    iframe.allow = 'autoplay; fullscreen; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    inner.replaceWith(iframe);
    return { ready: Promise.resolve(), play() {}, pause() {}, seek() {}, mute() {}, rates: () => [], setRate() {}, time: () => 0, duration: () => 0, destroy() { disposed = true; iframe.remove(); } };
  }
  await sdk(source.kind === 'youtube' ? 'youtube' : 'twitch');
  // A replacement load may have removed this mount while the SDK was loading.
  if (!inner.isConnected) throw new Error('Video load was replaced.');
  let readyResolve, readyReject, readyCheck, settled = false;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // Avoid unhandled rejections if a SDK constructor throws before the adapter is returned.
  ready.catch(() => {});
  const timeout = setTimeout(() => {
    clearInterval(readyCheck);
    if (!settled && !disposed) { settled = true; readyReject(new Error('The player didn’t become ready. Check the video’s availability, connection, or content blocker, then press Load again.')); }
  }, 25000);
  const complete = () => {
    if (disposed || settled) return;
    settled = true;
    clearTimeout(timeout);
    clearInterval(readyCheck);
    readyResolve();
  };
  const fail = message => {
    clearTimeout(timeout);
    clearInterval(readyCheck);
    if (!settled) { settled = true; readyReject(new Error(message)); }
    emit(onError, message);
  };
  if (source.kind === 'youtube') {
    let player;
    try {
      player = new window.YT.Player(inner.id, {
        width: '100%', height: '100%', videoId: source.id,
        playerVars: { autoplay: 0, controls: 1, playsinline: 1, rel: 0, origin: window.location.origin, start: Math.floor(start) },
        events: {
          onReady: event => {
            if (disposed) return;
            event.target.mute();
            const iframe = event.target.getIframe();
            iframe.title = 'YouTube video player';
            iframe.referrerPolicy = 'strict-origin-when-cross-origin';
            iframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
            complete();
          },
          onStateChange: event => {
            const states = { '-1': 'ready', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'ready' };
            if (states[event.data]) emit(onState, states[event.data]);
          },
          onError: event => fail(youtubeError(event.data)),
          onAutoplayBlocked: () => emit(onState, 'blocked'),
          onPlaybackRateChange: event => emit(onRate, event.data)
        }
      });
    } catch (error) { clearTimeout(timeout); throw error; }
    return {
      ready,
      play: () => player.playVideo(), pause: () => player.pauseVideo(),
      seek: seconds => player.seekTo(seconds, true),
      mute: muted => muted ? player.mute() : player.unMute(),
      time: () => player.getCurrentTime?.() || 0,
      duration: () => player.getDuration?.() || 0,
      rates: () => player.getAvailablePlaybackRates?.() || [1],
      setRate: rate => player.setPlaybackRate(rate),
      destroy() { disposed = true; clearTimeout(timeout); if (!settled) { settled = true; readyResolve(); } player.destroy(); }
    };
  }
  let player;
  try {
    player = new window.Twitch.Player(inner.id, {
      width: '100%', height: '100%', parent: parents, autoplay: false, muted: true,
      video: `v${source.id}`, time: `${Math.floor(start)}s`
    });
  } catch (error) { clearTimeout(timeout); throw error; }
  const listen = (name, callback) => {
    const event = window.Twitch.Player[name];
    if (event) player.addEventListener(event, data => { if (!disposed) callback(data); });
  };
  let readyEventSeen = false, muted = true, playRequested = false, playAcknowledged = false, attemptedWithSound = false, retriedMuted = false, playRetry;
  const clearPlayRetry = () => clearTimeout(playRetry);
  const prepareFrame = () => {
    const iframe = inner.querySelector?.('iframe');
    if (!iframe) return;
    iframe.title = 'Twitch VOD player';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
  };
  prepareFrame();
  // The SDK can signal READY before its cached VOD metadata arrives. Wait for
  // that snapshot so initialization seeks and the first play command are usable.
  const checkReady = () => {
    if (disposed || settled || !readyEventSeen) return;
    try { if (player.getDuration() > 0) complete(); } catch { /* Metadata is still arriving. */ }
  };
  const playerReady = () => { readyEventSeen = true; checkReady(); };
  listen('READY', playerReady);
  listen('VIDEO_READY', playerReady);
  readyCheck = setInterval(checkReady, 100);
  const acknowledgePlay = state => {
    playAcknowledged = true;
    clearPlayRetry();
    emit(onState, state);
  };
  listen('PLAY', () => acknowledgePlay('buffering'));
  listen('PLAYING', () => acknowledgePlay('playing'));
  listen('PAUSE', () => emit(onState, 'paused'));
  listen('ENDED', () => { playRequested = false; clearPlayRetry(); emit(onState, 'ended'); });
  listen('ERROR', () => { playRequested = false; clearPlayRetry(); fail('Twitch couldn’t play this VOD. It may be deleted, restricted, or blocked. Check the original link and try again.'); });
  const sendPlay = () => {
    // Reapply audio with the play request; an earlier initialization mute may
    // have reached Twitch before its command handler was ready.
    if (!muted) attemptedWithSound = true;
    player.setMuted(muted);
    player.play();
  };
  listen('PLAYBACK_BLOCKED', () => {
    clearPlayRetry();
    if (playRequested && attemptedWithSound && !retriedMuted) {
      // Programmatic playback with sound can be rejected even when the user
      // clicks the shared button. Retry once muted and reflect it in the UI.
      retriedMuted = true;
      muted = true;
      emit(onMutedFallback);
      if (!playRequested || disposed) return;
      emit(onState, 'buffering');
      sendPlay();
      return;
    }
    playRequested = false;
    emit(onState, 'blocked');
  });
  return {
    ready,
    play() {
      prepareFrame();
      clearPlayRetry();
      playRequested = true;
      playAcknowledged = false;
      attemptedWithSound = false;
      retriedMuted = false;
      emit(onState, 'buffering');
      sendPlay();
      // Recover a first command lost during Twitch's initialization. A slow
      // buffer is never treated as an autoplay failure or forcibly paused.
      if (playRequested && !playAcknowledged) {
        playRetry = setTimeout(() => {
          if (!disposed && playRequested && !playAcknowledged) sendPlay();
        }, 1000);
      }
    },
    pause() { playRequested = false; clearPlayRetry(); player.pause(); },
    seek: seconds => { if (source.seekable) player.seek(seconds); },
    mute(value) { muted = Boolean(value); player.setMuted(muted); },
    time: () => source.seekable ? player.getCurrentTime() || 0 : 0,
    duration: () => source.seekable ? player.getDuration() || 0 : 0,
    rates: () => [], setRate() {},
    destroy() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timeout);
      clearInterval(readyCheck);
      clearPlayRetry();
      if (!settled) { settled = true; readyResolve(); }
      try { player.pause(); } catch { /* May be destroyed while loading. */ }
      // Twitch has no documented destroy method; removing its owned DOM unloads the embed.
      inner.remove();
    }
  };
}
