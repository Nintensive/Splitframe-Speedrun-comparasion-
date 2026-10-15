const ASSETS = /* INLINE_ASSETS */ {};
const PUBLIC_PLAYBACK_CLIENT_ID = 'ue6666qo983tsx6so1t0vnawi233wa';
const encoder = new TextEncoder();

class PlaybackError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

async function limitedText(response, limit = 262144) {
  const reader = response.body.getReader();
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new PlaybackError('Twitch returned an oversized playback response.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  const body = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}

async function upstream(url, options = {}, fetcher = (input, init) => fetch(input, init)) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(url, { ...options, signal: controller.signal, redirect: 'manual' });
    if (!response.ok) {
      await response.body?.cancel();
      throw new PlaybackError(response.status === 403
        ? 'Twitch restricted this video. It must be publicly playable without signing in.'
        : `Twitch could not load the video (HTTP ${response.status}). Try loading it again.`, response.status === 403 ? 403 : 502);
    }
    return response;
  } catch (error) {
    if (error.name === 'AbortError') throw new PlaybackError('Twitch took too long to respond. Press Load to retry.');
    throw error;
  } finally { clearTimeout(timeout); }
}

async function gql(query, fetcher) {
  const response = await upstream('https://gql.twitch.tv/gql', {
    method: 'POST', headers: { 'content-type': 'application/json', 'client-id': PUBLIC_PLAYBACK_CLIENT_ID }, body: JSON.stringify({ query })
  }, fetcher);
  const data = JSON.parse(await limitedText(response));
  if (data.errors?.length || !data.data) throw new PlaybackError('Twitch could not provide public playback for this video. Try another public video.');
  return data.data;
}

function publicToken(token) {
  if (!token?.value || !token.signature) throw new PlaybackError('This Twitch video is unavailable or requires signing in.', 403);
  let data;
  try { data = JSON.parse(token.value); } catch { throw new PlaybackError('Twitch returned an invalid playback response.'); }
  if (data.authorization?.forbidden) throw new PlaybackError('This Twitch video is restricted or subscriber only. Choose a public recording.', 403);
  return data;
}

export function allowedMediaUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new PlaybackError('Invalid Twitch media URL.', 400); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || ![
    '.ttvnw.net', '.cloudfront.net', '.twitchcdn.net', '.twitch.tv'
  ].some(suffix => url.hostname.endsWith(suffix))) throw new PlaybackError('Unsupported Twitch media host.', 400);
  return url;
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode64(value) {
  const bytes = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bytes, char => char.charCodeAt(0));
}
async function relayKey(secret) {
  if (!secret) throw new PlaybackError('The Twitch playback service is not configured.');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function mediaLink(input, secret, expires) {
  const url = allowedMediaUrl(input).href;
  const payload = `${expires}.${url}`;
  const signature = await crypto.subtle.sign('HMAC', await relayKey(secret), encoder.encode(payload));
  return `/api/twitch/media?u=${base64url(encoder.encode(url))}&e=${expires}&s=${base64url(new Uint8Array(signature))}`;
}

export async function rewritePlaylist(text, origin, secret, expires) {
  if (!text.startsWith('#EXTM3U')) throw new PlaybackError('Twitch did not return a usable video playlist.');
  const lines = [];
  for (const line of text.split(/\r?\n/)) {
    if (line && !line.startsWith('#')) lines.push(await mediaLink(new URL(line, origin).href, secret, expires));
    else {
      let rewritten = line;
      const uris = [...line.matchAll(/URI="([^"]+)"/g)];
      for (const match of uris) rewritten = rewritten.replace(match[0], `URI="${await mediaLink(new URL(match[1], origin).href, secret, expires)}"`);
      lines.push(rewritten);
    }
  }
  return lines.join('\n');
}

const tokenParams = 'params:{platform:"web",playerBackend:"mediaplayer",playerType:"site"}';

export async function twitchApi(request, env, fetcher = (input, init) => fetch(input, init)) {
  const url = new URL(request.url);
  if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Use GET for playback.' }, 405);
  try {
    const clipMatch = url.pathname.match(/^\/api\/twitch\/clip\/([A-Za-z0-9_-]{3,200})$/);
    if (clipMatch) {
      const data = await gql(`{clip(slug:${JSON.stringify(clipMatch[1])}){title durationSeconds videoQualities{quality frameRate sourceURL} playbackAccessToken(${tokenParams}){value signature}}}`, fetcher);
      const clip = data.clip;
      if (!clip) throw new PlaybackError('This Twitch clip is private, deleted, or unavailable.', 404);
      publicToken(clip.playbackAccessToken);
      const quality = [...(clip.videoQualities || [])].filter(q => q.sourceURL).sort((a, b) => Number(b.quality) - Number(a.quality))[0];
      if (!quality) throw new PlaybackError('Twitch did not provide a playable clip.');
      const media = allowedMediaUrl(quality.sourceURL);
      media.searchParams.set('sig', clip.playbackAccessToken.signature);
      media.searchParams.set('token', clip.playbackAccessToken.value);
      return json({ url: media.href, duration: clip.durationSeconds, title: clip.title });
    }
    const vodMatch = url.pathname.match(/^\/api\/twitch\/vod\/(\d+)\/playlist\.m3u8$/);
    if (vodMatch) {
      const data = await gql(`{videoPlaybackAccessToken(id:${JSON.stringify(vodMatch[1])},${tokenParams}){value signature}}`, fetcher);
      const token = data.videoPlaybackAccessToken;
      const tokenData = publicToken(token);
      const manifest = new URL(`https://usher.ttvnw.net/vod/${vodMatch[1]}.m3u8`);
      for (const [key, value] of Object.entries({ nauth: token.value, nauthsig: token.signature, allow_source: 'true', allow_audio_only: 'false', supported_codecs: 'h264', platform: 'web', player: 'twitchweb' })) manifest.searchParams.set(key, value);
      const response = await upstream(manifest.href, {}, fetcher);
      const expires = Math.min(Number(tokenData.expires) || Infinity, Math.floor(Date.now() / 1000) + 86400);
      const playlist = await rewritePlaylist(await limitedText(response), manifest.href, env.TWITCH_RELAY_KEY, expires);
      return new Response(playlist, { headers: { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' } });
    }
    if (url.pathname === '/api/twitch/media') {
      const expires = Number(url.searchParams.get('e'));
      if (!Number.isSafeInteger(expires) || expires < Date.now() / 1000 || expires > Date.now() / 1000 + 86460) throw new PlaybackError('This Twitch playback link expired. Press Load to refresh it.', 403);
      let target, signature;
      try { target = allowedMediaUrl(new TextDecoder().decode(decode64(url.searchParams.get('u') || ''))); signature = decode64(url.searchParams.get('s') || ''); }
      catch { throw new PlaybackError('Invalid Twitch playback link.', 403); }
      const valid = await crypto.subtle.verify('HMAC', await relayKey(env.TWITCH_RELAY_KEY), signature, encoder.encode(`${expires}.${target.href}`));
      if (!valid) throw new PlaybackError('Invalid Twitch playback signature.', 403);
      const headers = new Headers();
      if (request.headers.has('range')) headers.set('range', request.headers.get('range'));
      const response = await upstream(target.href, { headers }, fetcher);
      if (/\.m3u8$/i.test(target.pathname)) {
        const playlist = await rewritePlaylist(await limitedText(response), target.href, env.TWITCH_RELAY_KEY, expires);
        return new Response(playlist, { headers: { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' } });
      }
      const out = new Headers({ 'content-type': response.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'private, max-age=60' });
      for (const header of ['content-length', 'content-range', 'accept-ranges']) if (response.headers.has(header)) out.set(header, response.headers.get(header));
      return new Response(response.body, { status: response.status, headers: out });
    }
    return json({ error: 'Unknown Twitch playback route.' }, 404);
  } catch (error) {
    if (!(error instanceof PlaybackError)) console.error(JSON.stringify({ component: 'twitch-playback', name: error.name, message: String(error.message).slice(0, 200) }));
    return json({ error: error instanceof PlaybackError ? error.message : 'Twitch playback could not load. Press Load to retry or choose another public video.' }, error instanceof PlaybackError ? error.status : 502);
  }
}

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/api/twitch/')) return twitchApi(request, env);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    const asset = ASSETS[pathname === '/' ? '/index.html' : pathname];
    if (!asset) return new Response('Not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : asset.body, { headers: { 'content-type': asset.type, 'cache-control': 'public, max-age=0, must-revalidate', 'referrer-policy': 'strict-origin-when-cross-origin' } });
  }
};
