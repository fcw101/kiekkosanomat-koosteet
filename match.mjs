// Kiekkosanomat maalikoosteet: matching and state logic. Node built-ins only, no dependencies.
// The site repo keeps a byte-identical copy at src/lib/koosteet-match.mjs (diff them when editing).
//
// Data contract per game follows Mose's HIGHLIGHTS.md: status none | pending | available,
// provider nhl (link-out only) | youtube (click-to-load embed). Status never goes back to pending.

export const CHANNEL_ID = 'UCqFMzb-4AUf6WAIbl132QKA'; // NHL (verified, @NHL)
/** Long-form uploads only (UULF = uploads without Shorts). 15 newest entries. */
export const FEED_URL = 'https://www.youtube.com/feeds/videos.xml?playlist_id=UULFqFMzb-4AUf6WAIbl132QKA';
export const SCORE_URL = (day) => `https://api-web.nhle.com/v1/score/${day}`;
export const GIVE_UP_MS = 24 * 3600e3;

/** NHL team common names as YouTube titles use them ("Kraken vs. Red Wings"). The score feed's name.default wins. */
export const TEAM_NAMES = {
	ANA: 'Ducks', BOS: 'Bruins', BUF: 'Sabres', CAR: 'Hurricanes', CBJ: 'Blue Jackets', CGY: 'Flames', CHI: 'Blackhawks',
	COL: 'Avalanche', DAL: 'Stars', DET: 'Red Wings', EDM: 'Oilers', FLA: 'Panthers', LAK: 'Kings', MIN: 'Wild',
	MTL: 'Canadiens', NJD: 'Devils', NSH: 'Predators', NYI: 'Islanders', NYR: 'Rangers', OTT: 'Senators', PHI: 'Flyers',
	PIT: 'Penguins', SEA: 'Kraken', SJS: 'Sharks', STL: 'Blues', TBL: 'Lightning', TOR: 'Maple Leafs', UTA: 'Mammoth',
	VAN: 'Canucks', VGK: 'Golden Knights', WPG: 'Jets', WSH: 'Capitals',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-09" -> "Oct 9, 2026" (the NHL game date, as in the YouTube title). */
export function titleDate(day) {
	const [y, m, d] = day.split('-').map(Number);
	return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** Exact recap title the NHL channel uses: "{away} vs. {home} | NHL Highlights | {Mon D, YYYY}". */
export function expectedTitle(g) {
	const away = g.awayName ?? TEAM_NAMES[g.away];
	const home = g.homeName ?? TEAM_NAMES[g.home];
	if (!away || !home) return null;
	return `${away} vs. ${home} | NHL Highlights | ${titleDate(g.date)}`;
}

/** Whitespace, case and Unicode normalisation only. No fuzzy matching. */
export const normTitle = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

const unxml = (s) =>
	s.replace(/&(amp|lt|gt|quot|apos|#39|#x27);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'" })[e]);

/** YouTube Atom feed -> [{ videoId, title, publishedAt, channelId }]. Regex parser: the feed format is fixed. */
export function parseFeed(xml) {
	const out = [];
	for (const m of String(xml ?? '').matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
		const e = m[1];
		const pick = (re) => (e.match(re) || [])[1];
		const videoId = pick(/<yt:videoId>([^<]+)<\/yt:videoId>/);
		const title = pick(/<title>([^<]*)<\/title>/);
		const publishedAt = pick(/<published>([^<]+)<\/published>/);
		const channelId = pick(/<yt:channelId>([^<]+)<\/yt:channelId>/);
		if (videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) && title && publishedAt) {
			out.push({ videoId, title: unxml(title), publishedAt, channelId: channelId ?? null });
		}
	}
	return out;
}

/** The feed's yt:channelId omits the "UC" prefix; accept both forms. */
const fromNhl = (v) => !v.channelId || v.channelId === CHANNEL_ID || `UC${v.channelId}` === CHANNEL_ID;

/**
 * games: [{ gameId, date, home, away, homeName?, awayName? }], videos: parseFeed() output.
 * Returns { [gameId]: video } for exact title matches only. Two videos with the same title: the earliest wins.
 */
export function matchVideos(games, videos) {
	const byTitle = new Map();
	for (const v of videos) {
		if (!fromNhl(v)) continue;
		const k = normTitle(v.title);
		const prev = byTitle.get(k);
		if (!prev || v.publishedAt < prev.publishedAt) byTitle.set(k, v);
	}
	const out = {};
	for (const g of games) {
		const t = expectedTitle(g);
		const v = t && byTitle.get(normTitle(t));
		if (v) out[g.gameId] = v;
	}
	return out;
}

/** nhl.com recap path from the score feed -> absolute URL, or null when it doesn't look like one. */
export function nhlRecapUrl(path) {
	if (typeof path !== 'string' || !/^\/video\/[a-z0-9-]+-\d{10,16}$/.test(path)) return null;
	return `https://www.nhl.com${path}`;
}

/** Home-first slug "<home>-<away>", "-2" for the second game of a same-day doubleheader. */
export function assignSlugs(games) {
	const seen = new Map();
	const sorted = [...games].sort((a, b) => String(a.start).localeCompare(String(b.start)) || Number(a.gameId) - Number(b.gameId));
	for (const g of sorted) {
		const base = `${g.home}-${g.away}`.toLowerCase();
		const key = `${g.date}/${base}`;
		const n = (seen.get(key) ?? 0) + 1;
		seen.set(key, n);
		g.slug = n === 1 ? base : `${base}-${n}`;
	}
	return games;
}

/** Raw /v1/score game -> compact game for matching. */
export function fromScore(raw) {
	return {
		gameId: String(raw.id),
		date: raw.gameDate,
		start: raw.startTimeUTC,
		home: raw.homeTeam?.abbrev,
		away: raw.awayTeam?.abbrev,
		homeName: raw.homeTeam?.name?.default ?? raw.homeTeam?.commonName?.default,
		awayName: raw.awayTeam?.name?.default ?? raw.awayTeam?.commonName?.default,
		final: raw.gameState === 'OFF' || raw.gameState === 'FINAL',
		nhlUrl: nhlRecapUrl(raw.threeMinRecap),
	};
}

const youtubeFields = (v) => ({
	provider: 'youtube',
	videoId: v.videoId,
	embedUrl: `https://www.youtube-nocookie.com/embed/${v.videoId}`,
	watchUrl: `https://www.youtube.com/watch?v=${v.videoId}`,
	sourceTitle: v.title,
	publishedAt: new Date(v.publishedAt).toISOString(),
});

/** First time we see a game final; capped at face-off + 3.5 h so a late first run still gives up on time. */
function firstFinal(g, now) {
	const est = g.start ? new Date(Date.parse(g.start) + 3.5 * 3600e3) : now;
	return (est < now ? est : now).toISOString();
}

/**
 * One game's next highlight state. prev: stored entry or undefined. g: fromScore() game (final).
 * video: matched feed entry or undefined. Transitions: pending -> available | none; available nhl -> youtube.
 */
export function nextEntry(prev, g, video, now = new Date()) {
	const base = {
		gameId: g.gameId, date: g.date, start: g.start, home: g.home, away: g.away,
		slug: g.slug ?? prev?.slug, finalSeenAt: prev?.finalSeenAt ?? firstFinal(g, now),
	};
	const nhlUrl = g.nhlUrl ?? prev?.nhlUrl ?? null;
	if (prev?.provider === 'youtube') return { ...prev, ...base, nhlUrl };
	if (video) return { ...base, status: 'available', ...youtubeFields(video), nhlUrl };
	if (nhlUrl) return { ...base, status: 'available', provider: 'nhl', watchUrl: nhlUrl, nhlUrl };
	if (prev?.status === 'none') return { ...prev, ...base };
	const age = now - new Date(base.finalSeenAt);
	return { ...base, status: age > GIVE_UP_MS ? 'none' : 'pending', nhlUrl: null };
}

const comparable = (e) => JSON.stringify(e, Object.keys(e).filter((k) => k !== 'updatedAt').sort());

/**
 * store: koosteet.json content. scoreGames: raw /v1/score games. videos: parseFeed() output.
 * Returns { store, changed, summary }. Entries older than keepDays (by game date) are pruned.
 */
export function reduce(store, scoreGames, videos, now = new Date(), keepDays = 30) {
	const games = { ...(store?.games ?? {}) };
	const compact = assignSlugs(scoreGames.map(fromScore).filter((g) => g.gameId && g.date && g.home && g.away));
	const matched = matchVideos(compact.filter((g) => g.final), videos);
	// Feed entries for games that are already stored but no longer in the fetched score days.
	const stale = Object.values(games).filter((e) => e.provider !== 'youtube' && !compact.some((g) => g.gameId === e.gameId));
	Object.assign(matched, matchVideos(stale, videos));
	const counts = { pending: 0, nhl: 0, youtube: 0, none: 0 };
	let changed = false;
	const touch = (id, next) => {
		const prev = games[id];
		if (!prev || comparable(prev) !== comparable(next)) {
			games[id] = { ...next, updatedAt: now.toISOString() };
			changed = true;
		}
	};
	for (const g of compact) if (g.final) touch(g.gameId, nextEntry(games[g.gameId], g, matched[g.gameId], now));
	for (const e of stale) {
		const g = { ...e, nhlUrl: e.nhlUrl };
		touch(e.gameId, nextEntry(e, g, matched[e.gameId], now));
	}
	const cutoff = new Date(now - keepDays * 86400e3).toISOString().slice(0, 10);
	for (const [id, e] of Object.entries(games)) {
		if (e.date < cutoff) {
			delete games[id];
			changed = true;
		}
	}
	for (const e of Object.values(games)) counts[e.status === 'available' ? e.provider : e.status]++;
	const summary = `${counts.youtube} youtube, ${counts.nhl} nhl, ${counts.pending} pending, ${counts.none} none`;
	const sorted = Object.fromEntries(Object.entries(games).sort(([a], [b]) => a.localeCompare(b)));
	return { store: { version: 1, channel: CHANNEL_ID, games: sorted }, changed, summary };
}

/** NHL (US Eastern) game dates whose games can still be within the 24 h give-up window. */
export function pollDates(now = new Date()) {
	const et = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
	return [...new Set([30, 12, 0].map((h) => et.format(new Date(now - h * 3600e3))))];
}
