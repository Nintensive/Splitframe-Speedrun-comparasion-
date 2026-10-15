import { ComparisonSession, parseVideoUrl, localVideoSource, parseTime, formatTime, shortcutAction, MAX_START } from './core.js';
import { createPlayer } from './players.js';

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const STORAGE_KEY = 'splitframe-session-v1';
const template = $('#player-template');
const views = ['A', 'B'].map((letter, index) => {
  const node = template.content.firstElementChild.cloneNode(true);
  node.dataset.index = index;
  node.setAttribute('aria-labelledby', `run-title-${index}`);
  $('.run-letter', node).textContent = letter;
  $('.run-title', node).id = `run-title-${index}`;
  $('.run-title', node).textContent = `Run ${letter}`;
  $('.run-subtitle', node).textContent = index === 0 ? 'Your run' : 'The run to beat';
  $('.empty-title', node).textContent = index === 0 ? 'Load your run' : 'Load your reference';
  $('.empty-watermark', node).textContent = letter;
  $('.url-input', node).id = `source-${index}`;
  $('.source-label', node).htmlFor = `source-${index}`;
  $('.source-label', node).textContent = `Run ${letter} video link`;
  $('.choose-file', node).setAttribute('aria-label', `Choose a local video for run ${letter}`);
  $('.file-input', node).setAttribute('aria-label', `Run ${letter} local video file`);
  $('.input-error', node).id = `source-error-${index}`;
  $('.url-input', node).setAttribute('aria-describedby', `source-error-${index}`);
  $('.start-time', node).setAttribute('aria-label', `Run ${letter} starting timestamp, minutes and seconds`);
  $('.start-range', node).setAttribute('aria-label', `Run ${letter} start point from zero to ten minutes`);
  $('.fps-select', node).setAttribute('aria-label', `Run ${letter} video frame rate`);
  $('.speed-select', node).setAttribute('aria-label', `Run ${letter} playback speed`);
  $('.current-time', node).setAttribute('aria-label', `Run ${letter} current time`);
  $('.embed-mount', node).setAttribute('aria-label', `Run ${letter} video player`);
  $('.open-source .sr-only', node).textContent = `Open run ${letter} on its original platform`;
  $('#players-grid').append(node);
  return node;
});

let persistEnabled = false;
let storageAvailable = true;
let savedSerialized = '';
let toastTimer;
const session = new ComparisonSession(() => {
  render();
  if (persistEnabled) save();
});

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('visible'), 4800);
}

function save() {
  if (!storageAvailable) return;
  const serialized = JSON.stringify(session.snapshot());
  if (serialized === savedSerialized) return;
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
    savedSerialized = serialized;
  } catch {
    storageAvailable = false;
    $('#save-note').textContent = 'Browser storage unavailable; this session won’t be saved.';
  }
}

function originalDuration(slot) {
  try { return slot.ready ? slot.adapter.duration() : 0; } catch { return 0; }
}

function updateRates(index) {
  const slot = session.slots[index], view = views[index];
  let rates = [];
  try { if (slot.ready) rates = slot.adapter.rates().filter(r => Number.isFinite(r) && r > 0); } catch { /* Player is reconnecting. */ }
  const selector = $('.speed-select', view);
  const key = rates.join(',');
  if (selector.dataset.rates !== key) {
    selector.replaceChildren();
    for (const rate of rates.length ? rates : [1]) {
      const option = document.createElement('option');
      option.value = rate;
      option.textContent = `${rate}×`;
      selector.append(option);
    }
    selector.dataset.rates = key;
  }
  selector.disabled = !slot.ready || rates.length < 2;
  selector.value = rates.includes(slot.rate) ? slot.rate : 1;
  $('.speed-note', view).textContent = slot.source?.kind === 'twitch-vod' ? 'Use Twitch’s player controls' : slot.source?.kind === 'twitch-clip' ? 'Use the clip’s controls' : !slot.ready ? 'Load a video to begin' : rates.length < 2 ? 'Normal speed only' : ['local', 'x-video', 'x-post'].includes(slot.source?.kind) ? 'Native video · 0.25–2×' : 'Supported by YouTube';
}

function render() {
  const stateNames = { empty: 'Waiting for video', reselect: 'Choose file again', loading: 'Loading player…', activate: 'Click Twitch Play once', ready: 'Ready', paused: 'Paused', playing: 'Playing', starting: 'Starting…', waiting: 'Waiting for Twitch', 'needs-click': 'Click Twitch Play', buffering: 'Buffering…', manual: 'Own controls', ended: 'Finished', blocked: 'Playback blocked', offline: 'Offline / unavailable', error: 'Couldn’t load' };
  session.slots.forEach((slot, index) => {
    const view = views[index];
    const hasSource = Boolean(slot.source);
    const error = slot.status === 'error';
    const loading = slot.status === 'loading';
    const local = slot.source?.kind === 'local';
    const reselect = slot.status === 'reselect';
    const canAdjust = hasSource && slot.source.seekable;
    $('.player-state', view).dataset.status = slot.ready && !slot.activated ? 'activate' : slot.status;
    $('.state-text', view).textContent = slot.ready && !slot.activated ? 'Click Twitch Play once' : stateNames[slot.status] || 'Ready';
    $('.source-type', view).textContent = slot.source?.label.toUpperCase() || 'NO VIDEO LOADED';
    $('.video-shell', view).classList.toggle('twitch', slot.source?.kind.startsWith('twitch') || false);

    $('.empty-player', view).hidden = slot.mounted && !error;
    $('.embed-mount', view).hidden = !slot.mounted || error;
    $('.empty-title', view).textContent = error ? 'Video couldn’t load' : reselect ? 'Choose your video again' : loading ? 'Getting your video ready…' : index === 0 ? 'Load your run' : 'Load your reference';
    $('.empty-description', view).textContent = error ? local ? 'Choose the file again, or try a different video format' : 'Press Load to retry, or choose a different link' : reselect ? 'Your start point is saved. Reselect the file to resume.' : loading ? local ? 'Reading video from your device' : 'Connecting to the original video platform' : 'Paste a link or choose a local video to get started';
    $('.empty-platforms', view).hidden = loading || error || reselect;
    const fileName = $('.file-name', view);
    fileName.textContent = local ? slot.source.filename : 'Stays on your device';
    fileName.title = local ? slot.source.filename : 'Local videos play on your device and are never uploaded.';
    const original = $('.open-source', view);
    original.hidden = !slot.source?.url;
    if (slot.source?.url) original.href = slot.source.url;
    else original.removeAttribute('href');
    const timestamp = $('.start-time', view);
    if (document.activeElement !== timestamp) timestamp.value = formatTime(slot.start);
    timestamp.disabled = !canAdjust;
    const range = $('.start-range', view);
    range.value = slot.start;
    range.disabled = !canAdjust;
    range.style.setProperty('--progress', `${slot.start / MAX_START * 100}%`);
    range.setAttribute('aria-valuetext', formatTime(slot.start));
    $('.fps-select', view).value = slot.fps;
    $('.fps-select', view).disabled = !canAdjust;
    $$('.frame-step, .second-buttons button, .zero-start', view).forEach(button => { button.disabled = !canAdjust; });
    $('.use-current', view).disabled = !slot.ready || !canAdjust;
    const message = $('.player-message', view);
    let text = slot.error;
    let info = false;
    if (!error) {
      if (reselect) { text = `Choose “${slot.source.filename}” again to restore this video. Its start point and FPS have been saved. Local videos aren’t uploaded.`; info = true; }
      else if (slot.ready && !slot.activated) { text = 'One-time Twitch setup: click Play inside this video. Splitframe will pause it at your saved start. Once each Twitch player is connected, use the shared Play button below.'; info = true; }
      else if (slot.status === 'blocked') text = 'Playback did not start. Click Play inside this player once, then click outside the video and retry the shared button or Space. Keep audio muted if the browser still blocks playback.';
      else if (slot.status === 'needs-click' || slot.status === 'waiting') text = 'Twitch has not started the shared Play request. Keep the video visible. Click Play inside Twitch once, pause it, then click outside the video and retry the shared Play button. For two Twitch videos, use a window wide enough to keep both players on screen.';
      else if (slot.status === 'offline') text = 'This video is unavailable. Check the original link or choose another recorded video.';
      else if (slot.source?.kind === 'twitch-clip') { text = 'Twitch clips use their own player controls. For shared play, pause and timestamps, paste a Twitch VOD link instead. Unavailable clips show a message inside Twitch’s player.'; info = true; }

      else text = '';
    }
    message.textContent = text;
    message.hidden = !text;
    message.classList.toggle('info', info);
    $('.narrow-twitch-note', view).hidden = !slot.source?.kind.startsWith('twitch');
    updateRates(index);
  });
  const loaded = session.slots.filter(s => s.ready).length;
  const hasSource = session.slots.some(s => s.source);
  $('#workspace-status').textContent = `${loaded} / 2 videos loaded`;
  $('#new-session').disabled = !hasSource;
  const targets = session.controlledSlots;
  const targetLabel = targets.length === 1 ? `run ${session.slots.indexOf(targets[0]) === 0 ? 'A' : 'B'}` : 'both';
  $('#play-both').disabled = !session.active && !session.canPlay;
  $('#play-both span').textContent = !session.active && session.activationSlots.length ? 'Connect Twitch first' : `${session.active ? 'Pause' : 'Play'} ${targetLabel}`;
  $('#play-both use').setAttribute('href', session.active ? '#i-pause' : '#i-play');
  $('#play-both').setAttribute('aria-label', !session.active && session.activationSlots.length ? 'Connect Twitch players using their own Play buttons first' : `${session.active ? 'Pause' : 'Play'} ${targetLabel}${targets.length === 1 ? '' : ' videos'}`);
  $('#reset-both').disabled = !session.canReset;
  const title = $('#transport-title'), note = $('#transport-note');
  if (session.activationSlots.length) {
    title.textContent = 'Connect your Twitch players';
    note.textContent = 'Click Play inside each Twitch video once. It will pause automatically, then the shared controls unlock.';
  } else if (session.slots.some(s => s.source && !s.source.control)) {
    title.textContent = targets.length ? `Shared controls target ${targetLabel}` : 'Independent player controls';
    note.textContent = 'Twitch clips use their own controls. YouTube, Twitch VODs, X videos and local files can be linked.';
  } else if (session.slots.some(s => s.status === 'error' || s.status === 'offline')) {
    title.textContent = 'A video needs attention';
    note.textContent = 'Check the message above and load it again.';
  } else if (session.slots.some(s => ['blocked', 'needs-click'].includes(s.status))) {
    title.textContent = 'Playback needs a click';
    note.textContent = 'Click inside the blocked player, then try again.';
  } else if (session.slots.some(s => s.status === 'reselect')) {
    title.textContent = 'Choose your local videos again';
    note.textContent = 'Your saved start points are ready. Reselect the files to resume.';
  } else if (session.slots.some(s => s.status === 'loading')) {
    title.textContent = 'Connecting your players';
    note.textContent = 'Ready videos can use the toolbar while the other player loads.';
  } else if (session.slots.some(s => s.status === 'waiting')) {
    title.textContent = 'Waiting for Twitch to start';
    note.textContent = 'Keep Twitch visible. If it stays paused, try its own Play button once.';
  } else if (session.slots.some(s => s.status === 'starting')) {
    title.textContent = 'Starting your comparison';
    note.textContent = 'Playback has been requested. Waiting for the videos to start.';
  } else if (session.canPlay) {
    title.textContent = session.active ? 'Playback controls linked' : targets.length === 2 ? 'Both players ready' : `${targetLabel === 'run A' ? 'Run A' : 'Run B'} ready`;
    note.textContent = targets.length === 2 ? 'Play together. Reset returns to your saved starts.' : 'This video can use the toolbar. Add a second supported video to link them.';
  } else {
    title.textContent = 'Ready when you are';
    note.textContent = 'Load two videos to link playback.';
  }
  $$('input[name="audio"]').forEach(input => { input.checked = input.value === session.audio; });
  if (storageAvailable) $('#save-note').textContent = session.slots.some(s => s.source?.kind === 'local') ? 'Settings saved · reselect files after refresh.' : hasSource ? 'Session saved in this browser.' : 'Paste a link or choose a local video.';
}

async function loadVideo(index, raw, preferences = {}) {
  const view = views[index];
  const input = $('.url-input', view);
  const inputError = $('.input-error', view);
  let source;
  try { source = parseVideoUrl(raw); } catch (error) {
    input.setAttribute('aria-invalid', 'true');
    inputError.textContent = error.message;
    inputError.hidden = false;
    input.focus();
    return;
  }
  input.removeAttribute('aria-invalid');
  inputError.hidden = true;
  $('.file-error', view).hidden = true;
  return mountSource(index, source, preferences);
}

async function mountSource(index, source, preferences = {}, file) {
  const view = views[index];
  const token = session.begin(index, source, preferences);
  if (source.seekable && source.clamped && preferences.start === undefined) toast('The linked timestamp is beyond 10 minutes. Start point set to 10:00.');
  try {
    const adapter = await createPlayer($('.embed-mount', view), source, {
      start: session.slots[index].start,
      file,
      onMount: () => {
        if (!session.isCurrent(index, token)) return;
        session.slots[index].mounted = true;
        session.notify();
      },
      onState: state => session.state(index, token, state),
      onError: message => session.fail(index, token, message),
      onMutedFallback: () => {
        if (!session.isCurrent(index, token)) return;
        session.setAudio('mute');
        toast('Twitch blocked playback with sound. Retrying muted. Click inside Twitch before enabling audio.');
      },
      onRate: rate => {
        if (!session.isCurrent(index, token)) return;
        session.slots[index].rate = rate;
        session.notify();
      }
    });
    await session.attach(index, token, adapter);
  } catch (error) { session.fail(index, token, error.message || 'The player could not load. Try again.'); }
}

function loadLocalVideo(index, file) {
  const view = views[index];
  let source;
  try { source = localVideoSource(file); } catch (error) {
    $('.file-error', view).textContent = error.message;
    $('.file-error', view).hidden = false;
    return;
  }
  const previous = session.slots[index];
  const sameFile = previous.status === 'reselect' && previous.source?.kind === 'local' && previous.source.filename === source.filename && previous.source.fileSize === source.fileSize && previous.source.lastModified === source.lastModified;
  const preferences = { fps: previous.fps, ...(sameFile ? { start: previous.start } : {}) };
  $('.file-error', view).hidden = true;
  $('.input-error', view).hidden = true;
  $('.url-input', view).removeAttribute('aria-invalid');
  $('.url-input', view).value = '';
  return mountSource(index, source, preferences, file);
}

views.forEach((view, index) => {
  const fileInput = $('.file-input', view);
  $('.choose-file', view).addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) loadLocalVideo(index, file);
  });
  $('.source-form', view).addEventListener('submit', event => {
    event.preventDefault();
    loadVideo(index, $('.url-input', view).value);
  });
  $('.url-input', view).addEventListener('input', () => {
    $('.url-input', view).removeAttribute('aria-invalid');
    $('.input-error', view).hidden = true;
  });
  const timestamp = $('.start-time', view);
  function applyTimestamp() {
    const value = parseTime(timestamp.value);
    if (value === null || !Number.isFinite(value)) {
      timestamp.value = formatTime(session.slots[index].start);
      toast('Enter a timestamp such as 1:23.500, or a number of seconds.');
      return;
    }
    if (value > MAX_START) toast('Start points can be set from 0:00 to 10:00.');
    session.setStart(index, value);
    timestamp.value = formatTime(session.slots[index].start);
  }
  timestamp.addEventListener('change', applyTimestamp);
  timestamp.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); applyTimestamp(); timestamp.blur(); }
    if (event.key === 'Escape') { timestamp.value = formatTime(session.slots[index].start); timestamp.blur(); }
  });
  $('.start-range', view).addEventListener('input', event => session.setStart(index, Number(event.target.value)));
  $$('.frame-step', view).forEach(button => button.addEventListener('click', () => session.nudge(index, Number(button.dataset.frame), true)));
  $$('.second-buttons button', view).forEach(button => button.addEventListener('click', () => session.nudge(index, Number(button.dataset.seconds))));
  $('.zero-start', view).addEventListener('click', () => session.setStart(index, 0));
  $('.fps-select', view).addEventListener('change', event => session.setFPS(index, Number(event.target.value)));
  $('.speed-select', view).addEventListener('change', event => {
    const slot = session.slots[index];
    session.setRate(index, Number(event.target.value));
    // Show the requested value until the player confirms the actual rate.
    if (slot.ready) setTimeout(() => updateRates(index), 1500);
  });
  $('.use-current', view).addEventListener('click', () => {
    try {
      const time = session.slots[index].adapter.time();
      if (time > MAX_START) toast('Current time is beyond 10 minutes. Start point set to 10:00.');
      session.setStart(index, time);
    } catch { toast('The video isn’t ready yet. Try again in a moment.'); }
  });
});

function togglePlayback() { session.toggle(); }
$('#play-both').addEventListener('click', togglePlayback);
$('#reset-both').addEventListener('click', () => session.reset());
$$('input[name="audio"]').forEach(input => input.addEventListener('change', () => session.setAudio(input.value)));
$('#new-session').addEventListener('click', () => {
  session.clear();
  for (const view of views) {
    $('.url-input', view).value = '';
    $('.url-input', view).removeAttribute('aria-invalid');
    $('.input-error', view).hidden = true;
    $('.file-error', view).hidden = true;
    $('.file-input', view).value = '';
    $('.embed-mount', view).replaceChildren();
  }
  $('.url-input', views[0]).focus();
  toast('New session ready. Paste your next two runs.');
});
$('#help-link').addEventListener('click', () => { $('#guide').open = true; });
document.addEventListener('keydown', event => {
  const action = shortcutAction(event, session);
  if (!action) return;
  event.preventDefault();
  if (action === 'toggle') togglePlayback();
  if (action === 'reset') session.reset();
});

function pollPlayers() {
  session.slots.forEach((slot, index) => {
    const view = views[index];
    let time = 0, duration = originalDuration(slot);
    try { if (slot.ready) time = slot.adapter.time(); } catch { /* Temporary player disconnect. */ }
    $('.current-time', view).textContent = slot.source && !slot.source.control ? 'MANUAL' : formatTime(time);
    $('.duration', view).textContent = duration ? `/ ${formatTime(duration, false)}` : '/ --:--';
    updateRates(index);
  });
}

// Broken or outdated browser storage must never prevent a fresh comparison.
let restored = null;
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const data = JSON.parse(raw);
    if (data.version === 1 && Array.isArray(data.slots)) restored = data;
  }
} catch { /* Use a fresh session if stored data is unavailable or invalid. */ }
render();
if (restored) {
  if (['mute', 'a', 'b', 'both'].includes(restored.audio)) session.audio = restored.audio;
  // Load both before enabling persistence so neither overwrites the other saved run.
  const loads = [];
  let localFilesToReselect = 0;
  for (let index = 0; index < 2; index++) {
    const saved = restored.slots[index];
    if (!saved) continue;
    const start = typeof saved.start === 'number' && Number.isFinite(saved.start) ? saved.start : undefined;
    if (saved.localFile) {
      try {
        const source = localVideoSource(saved.localFile);
        const token = session.begin(index, source, { start, fps: saved.fps });
        session.state(index, token, 'reselect');
        localFilesToReselect++;
      } catch { /* Ignore invalid saved local file metadata. */ }
      continue;
    }
    if (typeof saved.url !== 'string' || !saved.url) continue;
    $('.url-input', views[index]).value = saved.url;
    loads.push(loadVideo(index, saved.url, { start, fps: saved.fps }));
  }
  persistEnabled = true;
  save();
  if (localFilesToReselect) toast('Settings restored. Choose your local videos again to resume.');
  else if (loads.length) toast('Your last comparison has been restored. Playback stays paused.');
} else persistEnabled = true;
pollPlayers();
setInterval(pollPlayers, 500);
window.addEventListener('pagehide', () => session.pause());
