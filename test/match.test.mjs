// node --test   (Node 20+, no dependencies). Fixtures are real feeds saved on 2026-10-10 ~11:50 Helsinki.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	assignSlugs, expectedTitle, fromScore, matchVideos, nextEntry, nhlRecapUrl, parseFeed, pollDates, reduce, titleDate,
} from '../match.mjs';

const fx = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const score = (d) => JSON.parse(fx(`score-${d}.json`)).games;
const uulf = parseFeed(fx('feed-uulf-2026-10-10.xml'));
const channel = parseFeed(fx('feed-channel-2026-10-10.xml'));
const games = (d) => assignSlugs(score(d).map(fromScore));

test('parseFeed reads all 15 entries with ids, titles and dates', () => {
	assert.equal(uulf.length, 15);
	assert.equal(channel.length, 15);
	const sea = uulf.find((v) => v.videoId === '9FcuOiqdPnw');
	assert.equal(sea.title, 'Kraken vs. Red Wings | NHL Highlights | Oct 9, 2026');
	assert.equal(sea.publishedAt, '2026-10-10T01:52:18+00:00');
	assert.equal(sea.channelId, 'UCqFMzb-4AUf6WAIbl132QKA');
});

test('title date and expected title use the NHL game date, away team first', () => {
	assert.equal(titleDate('2026-10-09'), 'Oct 9, 2026');
	const sea = games('2026-10-09').find((g) => g.gameId === '2026020066');
	assert.equal(expectedTitle(sea), 'Kraken vs. Red Wings | NHL Highlights | Oct 9, 2026');
});

test('Oct 9: all four finished games match their recap', () => {
	const m = matchVideos(games('2026-10-09'), uulf);
	assert.deepEqual(
		Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.videoId])),
		{ 2026020066: '9FcuOiqdPnw', 2026020067: 'E_aedMVIYuA', 2026020068: 'DrYfZr9de30', 2026020069: 'M1-TOVgNclU' },
	);
});

test('Oct 8: English recaps still in the feed match; French ones and games pushed out do not', () => {
	const m = matchVideos(games('2026-10-08'), uulf);
	const ids = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.videoId]));
	assert.deepEqual(ids, {
		2026020057: '2rc85ht75aY', // Stars vs. Sabres
		2026020062: 'OPtJxjNrnWo', // Blackhawks vs. Islanders
		2026020063: 's1Je7m-PR30', // Sharks vs. Blues
		2026020064: 'hqm4SCEHpjU', // Avalanche vs. Flames
		2026020065: 'AMNnJhkiMZs', // Maple Leafs vs. Golden Knights
	});
	// "Flyers vs Sénateurs | 08/10/26 | Faits saillants" must not match PHI at OTT.
	assert.equal(m['2026020059'], undefined);
	assert.equal(m['2026020058'], undefined);
});

test('the channel feed (with Shorts) gives the same Oct 9 matches, Shorts never match', () => {
	const m = matchVideos(games('2026-10-09'), channel);
	assert.equal(Object.keys(m).length, 4);
	assert.ok(!Object.values(m).some((v) => v.videoId === 'snTFboqZ3M8'));
});

test('no fuzzy matching: wrong date, swapped teams or a foreign channel never match', () => {
	const g = { gameId: '1', date: '2026-10-09', home: 'DET', away: 'SEA' };
	const v = { videoId: 'AAAAAAAAAAA', publishedAt: '2026-10-10T01:00:00Z', channelId: 'UCqFMzb-4AUf6WAIbl132QKA' };
	assert.equal(Object.keys(matchVideos([g], [{ ...v, title: 'Kraken vs. Red Wings | NHL Highlights | Oct 8, 2026' }])).length, 0);
	assert.equal(Object.keys(matchVideos([g], [{ ...v, title: 'Red Wings vs. Kraken | NHL Highlights | Oct 9, 2026' }])).length, 0);
	assert.equal(Object.keys(matchVideos([g], [{ ...v, title: 'Kraken vs. Red Wings | NHL Highlights | Oct 9, 2026', channelId: 'UCsomeoneElse' }])).length, 0);
	assert.equal(Object.keys(matchVideos([g], [{ ...v, title: '  kraken VS. red wings |  NHL Highlights | Oct 9, 2026 ' }])).length, 1);
});

test('two uploads with the same title: the earliest wins', () => {
	const g = { gameId: '1', date: '2026-10-09', home: 'DET', away: 'SEA' };
	const t = 'Kraken vs. Red Wings | NHL Highlights | Oct 9, 2026';
	const m = matchVideos([g], [
		{ videoId: 'BBBBBBBBBBB', title: t, publishedAt: '2026-10-10T03:00:00+00:00' },
		{ videoId: 'AAAAAAAAAAA', title: t, publishedAt: '2026-10-10T02:00:00+00:00' },
	]);
	assert.equal(m['1'].videoId, 'AAAAAAAAAAA');
});

test('nhl.com recap paths from the score feed', () => {
	assert.equal(nhlRecapUrl('/video/sea-at-det-recap-6406572341112'), 'https://www.nhl.com/video/sea-at-det-recap-6406572341112');
	assert.equal(nhlRecapUrl('/video/6406572341112'), null);
	assert.equal(nhlRecapUrl('https://evil.example/video/x-1234567890'), null);
	assert.equal(nhlRecapUrl(null), null);
});

test('slugs are home-first, with -2 for a doubleheader', () => {
	assert.equal(games('2026-10-09').find((g) => g.gameId === '2026020068').slug, 'cbj-pit');
	const dh = assignSlugs([
		{ gameId: '2', date: '2026-10-09', start: '2026-10-09T23:00:00Z', home: 'CBJ', away: 'PIT' },
		{ gameId: '1', date: '2026-10-09', start: '2026-10-09T17:00:00Z', home: 'CBJ', away: 'PIT' },
	]);
	assert.deepEqual(dh.map((g) => [g.gameId, g.slug]), [['2', 'cbj-pit-2'], ['1', 'cbj-pit']]);
});

test('state machine: pending -> nhl -> youtube, never back; none after 24 h', () => {
	const t0 = new Date('2026-10-10T01:40:00Z');
	const g = { gameId: '9', date: '2026-10-09', start: '2026-10-09T23:00:00Z', home: 'DET', away: 'SEA', slug: 'det-sea', nhlUrl: null };
	const p = nextEntry(undefined, g, undefined, t0);
	assert.equal(p.status, 'pending');
	const n = nextEntry(p, { ...g, nhlUrl: 'https://www.nhl.com/video/sea-at-det-recap-6406572341112' }, undefined, t0);
	assert.deepEqual([n.status, n.provider, n.watchUrl], ['available', 'nhl', 'https://www.nhl.com/video/sea-at-det-recap-6406572341112']);
	const y = nextEntry(n, g, { videoId: '9FcuOiqdPnw', title: 'x', publishedAt: '2026-10-10T01:52:18+00:00' }, t0);
	assert.deepEqual([y.status, y.provider, y.videoId, y.embedUrl, y.publishedAt, y.nhlUrl],
		['available', 'youtube', '9FcuOiqdPnw', 'https://www.youtube-nocookie.com/embed/9FcuOiqdPnw', '2026-10-10T01:52:18.000Z', n.nhlUrl]);
	// The video later leaves the feed: stays youtube.
	assert.equal(nextEntry(y, g, undefined, new Date('2026-10-12T00:00:00Z')).provider, 'youtube');
	// Nothing ever arrives: pending, then none after 24 h, then stays none.
	const late = new Date(Date.parse(p.finalSeenAt) + 24.5 * 3600e3);
	const none = nextEntry(p, g, undefined, late);
	assert.equal(none.status, 'none');
	assert.equal(nextEntry(none, g, undefined, new Date(late.getTime() + 3600e3)).status, 'none');
});

test('reduce: real Oct 9 night -> 4 youtube; a second identical run reports no change', () => {
	const now = new Date('2026-10-10T08:50:00Z');
	const a = reduce({ games: {} }, [...score('2026-10-09'), ...score('2026-10-10')], uulf, now);
	assert.equal(a.changed, true);
	assert.equal(a.summary, '4 youtube, 0 nhl, 0 pending, 0 none');
	assert.equal(a.store.games['2026020066'].slug, 'det-sea');
	const b = reduce(a.store, [...score('2026-10-09'), ...score('2026-10-10')], uulf, new Date(now.getTime() + 600e3));
	assert.equal(b.changed, false);
});

test('reduce: busy night, matches survive after the entry leaves the 15-item feed', () => {
	const now = new Date('2026-10-09T06:00:00Z');
	const a = reduce({ games: {} }, score('2026-10-08'), uulf, now);
	assert.equal(a.summary, '5 youtube, 5 nhl, 0 pending, 0 none');
	const b = reduce(a.store, score('2026-10-08'), [], new Date('2026-10-09T08:00:00Z'));
	assert.equal(b.summary, '5 youtube, 5 nhl, 0 pending, 0 none');
	assert.equal(b.changed, false);
});

test('reduce: feed or score outage never deletes stored matches', () => {
	const a = reduce({ games: {} }, score('2026-10-09'), uulf, new Date('2026-10-10T08:50:00Z'));
	const b = reduce(a.store, [], [], new Date('2026-10-10T09:00:00Z'));
	assert.equal(b.changed, false);
	assert.equal(Object.keys(b.store.games).length, 4);
});

test('reduce: games outside 30 days are pruned; upcoming games are ignored', () => {
	const a = reduce({ games: {} }, score('2026-10-10'), uulf, new Date('2026-10-10T09:00:00Z'));
	assert.equal(Object.keys(a.store.games).length, 0);
	const b = reduce({ games: { 1: { gameId: '1', date: '2026-08-01', status: 'none' } } }, [], [], new Date('2026-10-10T09:00:00Z'));
	assert.equal(b.changed, true);
	assert.equal(Object.keys(b.store.games).length, 0);
});

test('poll dates cover the 24 h window in US Eastern dates', () => {
	assert.deepEqual(pollDates(new Date('2026-10-10T09:10:00Z')), ['2026-10-08', '2026-10-09', '2026-10-10']);
	assert.deepEqual(pollDates(new Date('2026-10-10T03:00:00Z')), ['2026-10-08', '2026-10-09']);
});
