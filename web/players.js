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

function createMediaPlayer(mount, mediaUrl, { label, provider = 'X', local = false, setupMedia, release = () => {}, onState = () => {}, onError = () => {}, onRate = () => {}, onMount = () => {} } = {}) {
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
  const timeout = setTimeout(() => fail(local ? 'The browser couldn’t read this video’s duration. Choose it again, or try an MP4 or WebM version.' : `${provider} video did not load. Press Load to retry, or choose a local copy.`), 30000);
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
  video.addEventListener('error', () => fail(local ? localVideoError(video.error?.code) : `${provider} video is unavailable, expired, or unsupported by this browser. Press Load to retry, or choose a local copy.`));
  mount.replaceChildren(video);
  onMount();
  let cleanupMedia = () => {};
  if (setupMedia) {
    try { cleanupMedia = setupMedia(video, fail) || cleanupMedia; } catch (error) { fail(error.message); }
  } else video.src = mediaUrl;
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
      cleanupMedia();
      video.removeAttribute('src');
      video.load();
      video.remove();
      release();
    }
  };
}

let hlsPromise;
async function loadHls() {
  if (window.Hls) return window.Hls;
  if (!hlsPromise) {
    hlsPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => reject(new Error('The Twitch video player took too long to load. Press Load to retry.')), 15000);
      script.src = new URL('./vendor/hls.light.min.js', import.meta.url).href;
      script.async = true;
      script.onload = () => { clearTimeout(timeout); window.Hls ? resolve(window.Hls) : reject(new Error('Twitch video playback is unavailable.')); };
      script.onerror = () => { clearTimeout(timeout); reject(new Error('Couldn’t load the Twitch video player. Press Load to retry.')); };
      document.head.append(script);
    });
    hlsPromise.catch(() => { hlsPromise = null; });
  }
  return hlsPromise;
}

async function createTwitchPlayer(mount, source, options) {
  const placeholder = document.createElement('div');
  mount.replaceChildren(placeholder);
  options.onMount?.();
  if (source.kind === 'twitch-clip') {
    const response = await fetch(`/api/twitch/clip/${source.id}`, { credentials: 'omit' });
    const data = await response.json();
    if (!response.ok || !data.url) throw new Error(data.error || 'This Twitch clip could not load.');
    const url = new URL(data.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['.twitch.tv', '.ttvnw.net', '.cloudfront.net', '.twitchcdn.net'].some(suffix => url.hostname.endsWith(suffix))) throw new Error('Twitch returned an unsupported clip media URL.');
    if (!placeholder.isConnected) throw new Error('Video load was replaced.');
    return createMediaPlayer(mount, url.href, { ...options, provider: 'Twitch', label: 'Twitch clip video player' });
  }
  const Hls = await loadHls();
  if (!placeholder.isConnected) throw new Error('Video load was replaced.');
  const url = `/api/twitch/vod/${source.id}/playlist.m3u8`;
  return createMediaPlayer(mount, url, { ...options, provider: 'Twitch', label: 'Twitch VOD video player', setupMedia(video, fail) {
    if (video.canPlayType?.('application/vnd.apple.mpegurl')) { video.src = url; return; }
    if (!Hls.isSupported()) throw new Error('This browser cannot play Twitch recordings here. Try a current browser or a local copy.');
    const hls = new Hls({ maxBufferLength: 20, backBufferLength: 15, enableWorker: true });
    let networkRetries = 0, mediaRetries = 0;
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries++ < 2) { hls.startLoad(); return; }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries++ < 1) { hls.recoverMediaError(); return; }
      let message = 'Twitch video playback could not start. Press Load to retry, or choose another public recording.';
      try { message = JSON.parse(data.response?.data || data.networkDetails?.responseText || '{}').error || message; } catch { /* Keep the readable fallback. */ }
      hls.destroy(); fail(message);
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    return () => hls.destroy();
  } });
}

export function createLocalPlayer(mount, file, options = {}) {
  if (!file) throw new Error('Choose the local video again to load it.');
  const objectUrl = URL.createObjectURL(file);
  return createMediaPlayer(mount, objectUrl, { ...options, label: `Local video: ${file.name}`, local: true, release: () => URL.revokeObjectURL(objectUrl) });
}

export async function resolveXVideo(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    // Public-post metadata, using the same service as the reference tool.
    const response = await fetch(`https://api.fxtwitter.com/i/status/${source.id}`, {
      signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer'
    });
    if ([401, 403, 404].includes(response.status)) throw new Error('This X post is private, deleted, or unavailable. Try a public video post or choose a local copy.');
    if (!response.ok) throw new Error('X video lookup is temporarily unavailable. Press Load to retry.');
    const data = await response.json();
    if ([401, 403, 404].includes(data.code)) throw new Error('This X post is private, deleted, or unavailable. Try a public video post or choose a local copy.');
    if (data.code !== 200 || !data.tweet) throw new Error('X video lookup is temporarily unavailable. Press Load to retry.');
    if (data.tweet.id && String(data.tweet.id) !== source.id) throw new Error('X returned a different post. Check the link and try again.');
    const video = data.tweet.media?.videos?.[source.mediaIndex || 0];
    if (!video?.url) throw new Error('This X post has no playable video at that position. Choose a video post or a local copy.');
    let url;
    try { url = new URL(video.url); } catch { throw new Error('X did not return a usable video link. Try another post.'); }
    if (url.protocol !== 'https:' || url.hostname !== 'video.twimg.com' || url.port || url.username || url.password || !/\.mp4$/i.test(url.pathname)) {
      throw new Error('X did not return a supported MP4 video. Choose another post or a local copy.');
    }
    return url.href;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('X video lookup timed out. Press Load to retry.');
    if (error instanceof TypeError) throw new Error('Couldn’t reach the X video lookup service. Check your connection or content blocker and press Load.');
    throw error;
  } finally { clearTimeout(timeout); }
}

async function fetchXVideo(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    // X's CDN can reject third-party Referer headers. Fetch a browser-local
    // copy with an explicit policy, without changing YouTube/Twitch referrers.
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`X returned HTTP ${response.status} for this video. Press Load to retry, or choose a local copy.`);
    const blob = await response.blob();
    if (!blob.size || (blob.type && !/^(video\/|application\/octet-stream)/i.test(blob.type))) throw new Error('X did not return a playable video file. Try another video post.');
    return blob;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The X video download timed out. Press Load to retry, or choose a local copy.');
    if (error instanceof TypeError) throw new Error('Couldn’t download this X video. Check your connection or content blocker, then press Load.');
    throw error;
  } finally { clearTimeout(timeout); }
}

export async function createPlayer(mount, source, { start = 0, file, onState = () => {}, onError = () => {}, onRate = () => {}, onMount = () => {}, onMutedFallback = () => {} } = {}) {
  if (source.kind === 'local') return createLocalPlayer(mount, file, { onState, onError, onRate, onMount });
  if (source.kind.startsWith('twitch')) return createTwitchPlayer(mount, source, { onState, onError, onRate, onMount });
  let disposed = false;
  const emit = (callback, value) => { if (!disposed) callback(value); };
  const parents = twitchParents(window.location, Array.from(window.location.ancestorOrigins || []), document.referrer, window.self !== window.top);
  const inner = document.createElement('div');
  inner.id = `embed-${crypto.randomUUID()}`;
  mount.replaceChildren(inner);
  onMount();
  if (['x-post', 'x-video'].includes(source.kind)) {
    const mediaUrl = source.kind === 'x-post' ? await resolveXVideo(source) : source.url;
    const blob = await fetchXVideo(mediaUrl);
    if (!inner.isConnected) throw new Error('Video load was replaced.');
    const objectUrl = URL.createObjectURL(blob);
    return createMediaPlayer(mount, objectUrl, { label: 'X video player', release: () => URL.revokeObjectURL(objectUrl), onState, onError, onRate, onMount });
  }
  await sdk(source.kind === 'youtube' ? 'youtube' : 'twitch');
  // A replacement load may have removed this mount while the SDK was loading.
  if (!inner.isConnected) throw new Error('Video load was replaced.');
  let readyResolve, readyReject, readyCheck, stateCheck, settled = false;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // Avoid unhandled rejections if a SDK constructor throws before the adapter is returned.
  ready.catch(() => {});
  const timeout = setTimeout(() => {
    clearInterval(readyCheck);
    clearInterval(stateCheck);
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
    clearInterval(stateCheck);
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
}
