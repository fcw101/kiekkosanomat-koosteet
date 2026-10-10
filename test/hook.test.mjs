import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { callHook, retryAfterMs } from '../hook.mjs';

const res = (status, ra) => ({ ok: status < 300, status, headers: { get: (k) => (k === 'retry-after' ? ra ?? null : null) } });
test('retries 429 with Retry-After, then succeeds', async () => {
	const seq = [res(429, '7'), res(503), res(204)], waits = [], logs = [];
	const ok = await callHook({ url: 'https://x/secret-hook', fetchImpl: async () => seq.shift(), wait: async (ms) => waits.push(ms), base: 20000, tries: 3, log: (m) => logs.push(m) });
	assert.equal(ok, true);
	assert.deepEqual(waits, [7000, 40000]);
	assert.ok(logs.every((l) => !l.includes('secret-hook')));
});
test('gives up after 3 tries; a 404 is not retried', async () => {
	let n = 0;
	assert.equal(await callHook({ url: 'u', fetchImpl: async () => (n++, res(429)), wait: async () => {}, log: () => {} }), false);
	assert.equal(n, 3);
	n = 0;
	assert.equal(await callHook({ url: 'u', fetchImpl: async () => (n++, res(404)), wait: async () => {}, log: () => {} }), false);
	assert.equal(n, 1);
});
test('Retry-After parsing is clamped to 60 s', () => {
	assert.equal(retryAfterMs('5'), 5000);
	assert.equal(retryAfterMs('600'), 60000);
	assert.equal(retryAfterMs(new Date(Date.now() + 10000).toUTCString()) > 8000, true);
	assert.equal(retryAfterMs(null), null);
});

// End to end: a failing hook sets pending; the next run with no koosteet change calls the hook and clears it.
const run = (dir, env) => new Promise((ok) => {
	const p = spawn(process.execPath, [path.join(dir, 'hook.mjs')], { env: { ...process.env, ...env, HOOK_WAIT_MS: '10', GITHUB_OUTPUT: path.join(dir, 'out') } });
	let s = ''; p.stdout.on('data', (d) => (s += d)); p.on('close', () => ok(s));
});
test('pending marker survives a failed run and is cleared by the next successful one', async () => {
	let mode = 429, hits = 0;
	const srv = createServer((q, r) => { hits++; r.writeHead(mode, mode === 429 ? { 'Retry-After': '0' } : {}).end(); });
	await new Promise((r) => srv.listen(0, '127.0.0.1', r));
	const url = `http://127.0.0.1:${srv.address().port}/hook-token`;
	const dir = mkdtempSync(path.join(tmpdir(), 'hook-'));
	cpSync(new URL('../hook.mjs', import.meta.url), path.join(dir, 'hook.mjs'));
	writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
	writeFileSync(path.join(dir, 'deploy-state.json'), '{"pending": false}\n');
	const log1 = await run(dir, { HOOK: url, NEED: 'true' });
	assert.equal(hits, 3);
	assert.ok(!log1.includes('hook-token'));
	assert.equal(JSON.parse(readFileSync(path.join(dir, 'deploy-state.json'))).pending, true);
	assert.match(readFileSync(path.join(dir, 'out'), 'utf8'), /ok=false\nstate_changed=true/);
	mode = 204;
	await run(dir, { HOOK: url, NEED: 'false' });
	assert.equal(hits, 4, 'pending alone triggers the hook');
	assert.equal(JSON.parse(readFileSync(path.join(dir, 'deploy-state.json'))).pending, false);
	await run(dir, { HOOK: url, NEED: 'false' });
	assert.equal(hits, 4, 'nothing pending, nothing changed: no call');
	srv.close();
});
