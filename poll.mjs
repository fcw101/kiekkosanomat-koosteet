#!/usr/bin/env node
// One poll: NHL score feed (recap links) + NHL YouTube long-form feed (embeds) -> koosteet.json.
// Node 20+ built-ins only. Never throws on network errors: a failed source just means no change this run.
// Writes changed=true|false and summary=... to $GITHUB_OUTPUT when it exists.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { FEED_URL, SCORE_URL, parseFeed, pollDates, reduce } from './match.mjs';

const FILE = new URL('./koosteet.json', import.meta.url);
const TIMEOUT = 10_000;

async function get(url, type) {
	const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { accept: type, 'user-agent': 'kiekkosanomat-koosteet (+https://kiekkosanomat.com)' } });
	if (!res.ok) throw new Error(`HTTP ${res.status} ${new URL(url).pathname}`);
	return type.includes('json') ? res.json() : res.text();
}

function readStore() {
	try {
		return JSON.parse(readFileSync(FILE, 'utf8'));
	} catch {
		return { version: 1, games: {} };
	}
}

const now = new Date();
const store = readStore();
const days = pollDates(now);
const games = [];
let scoreOk = 0;
for (const day of days) {
	try {
		games.push(...((await get(SCORE_URL(day), 'application/json')).games ?? []));
		scoreOk++;
	} catch (e) {
		console.warn(`score ${day}: ${e.message}`);
	}
}
let videos = [];
try {
	// Cache-buster: without it the feed CDN serves copies up to 15 min old (max-age=900).
	videos = parseFeed(await get(`${FEED_URL}&_=${now.getTime()}`, 'application/atom+xml'));
} catch (e) {
	console.warn(`feed: ${e.message}`);
}

const { store: next, changed, summary } = reduce(store, games, videos, now);
if (changed) writeFileSync(FILE, `${JSON.stringify(next, null, '\t')}\n`);
console.log(`days ${days.join(',')} (score ok ${scoreOk}/${days.length}), feed ${videos.length} entries -> ${changed ? 'CHANGED' : 'no change'}: ${summary}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\nsummary=${summary}\n`);
