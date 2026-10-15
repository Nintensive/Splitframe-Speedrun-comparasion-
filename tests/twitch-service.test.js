import test from 'node:test';
import assert from 'node:assert/strict';
import { twitchApi, allowedMediaUrl, rewritePlaylist } from '../worker/index.js';

const env = { TWITCH_RELAY_KEY: 'unit-test-only-signing-key' };
const host = 'https://compare.example';
const token = () => ({ value: JSON.stringify({ authorization: { forbidden: false }, expires: Math.floor(Date.now() / 1000) + 3600 }), signature: 'public-playback-signature' });
const request = path => new Request(new URL(path, host));

test('public clips resolve to signed media and preserve provider errors without login attempts', async () => {
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++; assert.equal(url, 'https://gql.twitch.tv/gql');
    assert.equal(options.redirect, 'manual', 'The Worker runtime only supports manual/follow redirects');
    assert.equal(options.headers.authorization, undefined);
    assert.match(JSON.parse(options.body).query, /HelpfulClipSlug/);
    return Response.json({ data: { clip: { title: 'Public clip', durationSeconds: 32, playbackAccessToken: token(), videoQualities: [{ quality: '720', sourceURL: 'https://clips-media-assets2.twitch.tv/run.mp4' }] } } });
  };
  const response = await twitchApi(request('/api/twitch/clip/HelpfulClipSlug'), env, fetcher);
  const data = await response.json(); assert.equal(response.status, 200); assert.equal(data.duration, 32);
  const url = new URL(data.url); assert.equal(url.searchParams.get('sig'), 'public-playback-signature'); assert.ok(url.searchParams.has('token')); assert.equal(calls, 1);
  const unavailable = await twitchApi(request('/api/twitch/clip/HelpfulClipSlug'), env, async () => Response.json({ data: { clip: null } }));
  assert.equal(unavailable.status, 404); assert.match((await unavailable.json()).error, /private, deleted/);
});

test('restricted media never receives a media relay URL', async () => {
  const forbidden = token(); forbidden.value = JSON.stringify({ authorization: { forbidden: true } });
  let calls = 0;
  const response = await twitchApi(request('/api/twitch/vod/123/playlist.m3u8'), env, async () => {
    calls++; return Response.json({ data: { videoPlaybackAccessToken: forbidden } });
  });
  assert.equal(response.status, 403); assert.equal(calls, 1); assert.match((await response.json()).error, /restricted/);
});

test('VOD playlists relay variants, media segments and encryption keys through verified URLs', async () => {
  const visited = [];
  const fetcher = async url => {
    visited.push(url);
    if (url === 'https://gql.twitch.tv/gql') return Response.json({ data: { videoPlaybackAccessToken: token() } });
    if (url.startsWith('https://usher.ttvnw.net/')) return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nhttps://d123.cloudfront.net/video/index.m3u8');
    if (url.endsWith('index.m3u8')) return new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:2,\npart.ts\n#EXT-X-ENDLIST');
    return new Response('media-bytes', { headers: { 'content-type': 'video/mp2t' } });
  };
  const master = await twitchApi(request('/api/twitch/vod/123/playlist.m3u8'), env, fetcher);
  assert.equal(master.status, 200);
  const variantUrl = (await master.text()).split('\n').at(-1);
  assert.match(variantUrl, /^\/api\/twitch\/media\?/);
  const variant = await twitchApi(request(variantUrl), env, fetcher);
  const text = await variant.text(); assert.equal(variant.status, 200);
  assert.match(text, /URI="\/api\/twitch\/media\?/);
  const segmentUrl = text.split('\n').find(line => line.startsWith('/api/'));
  const segment = await twitchApi(request(segmentUrl), env, fetcher);
  assert.equal(await segment.text(), 'media-bytes'); assert.ok(visited.includes('https://d123.cloudfront.net/video/part.ts'));
});

test('forged, expired and off-host media links are rejected without outbound requests', async () => {
  let calls = 0; const fetcher = async () => { calls++; throw new Error('Must not fetch'); };
  for (const path of ['/api/twitch/media?u=a&e=0&s=a', `/api/twitch/media?u=a&e=${Math.floor(Date.now() / 1000) + 60}&s=a`, '/api/twitch/vod/not-an-id/playlist.m3u8']) {
    const response = await twitchApi(request(path), env, fetcher);
    assert.ok([403, 404].includes(response.status));
  }
  assert.equal(calls, 0);
  for (const url of ['http://clips.twitch.tv/a', 'https://twitch.tv.evil.example/a', 'https://user:secret@clips.twitch.tv/a', 'https://127.0.0.1/a']) assert.throws(() => allowedMediaUrl(url));
  await assert.rejects(rewritePlaylist('#EXTM3U\nhttps://evil.example/a.ts', 'https://d123.cloudfront.net/a.m3u8', env.TWITCH_RELAY_KEY, Math.floor(Date.now() / 1000) + 60), /Unsupported/);
});

test('range requests stream media and preserve partial-content headers', async () => {
  const path = (await rewritePlaylist('#EXTM3U\nhttps://d123.cloudfront.net/part.ts', 'https://d123.cloudfront.net/a.m3u8', env.TWITCH_RELAY_KEY, Math.floor(Date.now() / 1000) + 60)).split('\n')[1];
  const response = await twitchApi(new Request(new URL(path, host), { headers: { range: 'bytes=0-3' } }), env, async (_url, options) => {
    assert.equal(options.headers.get('range'), 'bytes=0-3');
    return new Response('data', { status: 206, headers: { 'content-range': 'bytes 0-3/100', 'accept-ranges': 'bytes' } });
  });
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 0-3/100'); assert.equal(await response.text(), 'data');
});
