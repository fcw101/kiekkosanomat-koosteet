// Calls the Vercel deploy hook with retries, and keeps a "rebuild pending" flag in deploy-state.json so a failed
// rebuild is retried by the NEXT run even when koosteet.json did not change. Node built-ins only.
//   HOOK          deploy hook URL (secret; never printed)
//   NEED          'true' when this run changed koosteet.json
//   HOOK_TRIES    attempts (default 3), HOOK_WAIT_MS base wait (default 20000: waits 20 s, 40 s; Retry-After honoured, max 60 s)
// Writes ok=true|false|skip and state_changed=true|false to $GITHUB_OUTPUT. Exit code is always 0; the workflow
// commits the state file first and fails the run afterwards when ok=false, so a failure is never silent.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const STATE = new URL('./deploy-state.json', import.meta.url);
const hook = process.env.HOOK ?? '';
const tries = Number(process.env.HOOK_TRIES ?? 3);
const base = Number(process.env.HOOK_WAIT_MS ?? 20000);
const out = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
const clean = (s) => String(s).split(hook).join('<hook>');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function readState(file = STATE) {
	try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { pending: false }; } catch { return { pending: false }; }
}

/** Seconds from a Retry-After header (delta-seconds or HTTP date), clamped to [0, 60]; null when absent. */
export function retryAfterMs(h, now = Date.now()) {
	if (!h) return null;
	const s = /^\d+$/.test(h.trim()) ? Number(h) * 1000 : Date.parse(h) - now;
	return Number.isFinite(s) ? Math.max(0, Math.min(60000, s)) : null;
}

export async function callHook({ url, tries: n = tries, base: b = base, fetchImpl = fetch, wait = sleep, log = console.log }) {
	for (let i = 1; i <= n; i += 1) {
		let status = 0, ra = null;
		try {
			const res = await fetchImpl(url, { method: 'POST', signal: AbortSignal.timeout(30000) });
			status = res.status;
			ra = res.headers.get('retry-after');
			if (res.ok) { log(`Deploy hook called (HTTP ${status}, try ${i}/${n}).`); return true; }
		} catch (e) {
			log(`Deploy hook try ${i}/${n}: ${clean(e?.name ?? 'error')}`);
		}
		if (status) log(`Deploy hook try ${i}/${n}: HTTP ${status}${ra ? `, Retry-After ${clean(ra)}` : ''}`);
		if (status >= 400 && status < 500 && status !== 429 && status !== 408) return false; // won't fix itself
		if (i < n) await wait(retryAfterMs(ra) ?? b * 2 ** (i - 1));
	}
	return false;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const state = readState();
	const need = process.env.NEED === 'true' || state.pending === true;
	if (!need) { console.log('No rebuild needed.'); out('ok', 'skip'); out('state_changed', 'false'); process.exit(0); }
	if (!hook) { console.log('VERCEL_DEPLOY_HOOK secret not set, skipping the rebuild.'); out('ok', 'skip'); out('state_changed', 'false'); process.exit(0); }
	if (state.pending) console.log(`Rebuild pending since ${state.since} (${state.reason}); calling the hook.`);
	const ok = await callHook({ url: hook });
	const now = new Date().toISOString();
	const next = ok ? { pending: false, lastOk: now } : { pending: true, since: state.pending ? state.since : now, reason: 'deploy hook failed', lastTry: now, lastOk: state.lastOk };
	const changed = ok ? state.pending === true || !existsSync(STATE) : true;
	if (changed) writeFileSync(STATE, `${JSON.stringify(next, null, '\t')}\n`);
	console.log(ok ? 'Rebuild requested.' : 'Rebuild still pending: the next run retries the hook.');
	out('ok', String(ok));
	out('state_changed', String(changed));
}
