import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpError } from '../../src/core/errors.ts';
import { MemoryHttpCache } from '../../src/core/http/cache.ts';
import { HttpClient } from '../../src/core/http/client.ts';
import { createLogger, nullLogger, redact, registerSecret } from '../../src/core/logger.ts';

function fakeFetch(responses: (() => Response)[]): { fetch: typeof fetch; calls: () => number } {
  let i = 0;
  return {
    fetch: (async () => {
      const next = responses[Math.min(i, responses.length - 1)]!;
      i++;
      return next();
    }) as unknown as typeof fetch,
    calls: () => i,
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function client(fetchImpl: typeof fetch, cache = new MemoryHttpCache()) {
  const waits: number[] = [];
  const c = new HttpClient({ name: 't', minIntervalMs: 0, maxRetries: 3, timeoutMs: 1000, cache, logger: nullLogger, fetchImpl, sleep: async (ms) => void waits.push(ms) });
  return { c, waits };
}

describe('cliente HTTP', () => {
  it('reintenta ante 429 respetando Retry-After', async () => {
    const f = fakeFetch([json({ error: 1 }, 429, { 'retry-after': '2' }), json({ ok: true })]);
    const { c, waits } = client(f.fetch);
    const res = await c.getJson<{ ok: boolean }>('https://x/a', { ttlSeconds: 60 });
    assert.equal(res.data.ok, true);
    assert.equal(f.calls(), 2);
    assert.ok(waits.includes(2000));
  });

  it('trata una página HTML (bloqueo de Cloudflare) como error reintentable', async () => {
    const html = () => new Response('<!doctype html><title>Access denied</title>', { status: 200, headers: { 'content-type': 'text/html' } });
    const f = fakeFetch([html, html, html, html]);
    const { c } = client(f.fetch);
    await assert.rejects(c.getJson('https://x/b', { ttlSeconds: 60 }), (e: unknown) => e instanceof HttpError && /no JSON/.test(e.message));
    assert.equal(f.calls(), 4);
  });

  it('no reintenta errores 4xx definitivos', async () => {
    const f = fakeFetch([json({}, 400)]);
    const { c } = client(f.fetch);
    await assert.rejects(c.getJson('https://x/c', { ttlSeconds: 60 }));
    assert.equal(f.calls(), 1);
  });

  it('usa la caché vigente sin tocar la red y la copia vencida solo si se permite', async () => {
    const cache = new MemoryHttpCache();
    const ok = fakeFetch([json({ v: 1 })]);
    await client(ok.fetch, cache).c.getJson('https://x/d', { ttlSeconds: 60 });
    const again = await client(fakeFetch([json({ v: 2 })]).fetch, cache).c.getJson<{ v: number }>('https://x/d', { ttlSeconds: 60 });
    assert.deepEqual([again.data.v, again.source], [1, 'cache']);

    const expired = new MemoryHttpCache();
    expired.set('ignored', '', '{}', 1);
    await client(ok.fetch, expired).c.getJson('https://x/e', { ttlSeconds: -1 }); // queda vencida al instante
    const down = fakeFetch([json({}, 503)]);
    const stale = await client(down.fetch, expired).c.getJson<Record<string, unknown>>('https://x/e', { ttlSeconds: 60, allowStale: true });
    assert.equal(stale.source, 'stale-cache');
  });
});

describe('ocultación de secretos', () => {
  it('nunca imprime tokens registrados ni parámetros sensibles de URL', () => {
    registerSecret('IGAAsecreto-de-prueba-123');
    assert.equal(redact('token=IGAAsecreto-de-prueba-123 listo'), 'token=*** listo');
    assert.equal(redact('https://g/x?fields=id&access_token=EAAotro123&y=1'), 'https://g/x?fields=id&access_token=***&y=1');
    const lines: string[] = [];
    createLogger({ level: 'info', write: (l) => lines.push(l) }).error('fallo', { url: 'https://g/x?access_token=EAAzzz999', t: 'IGAAsecreto-de-prueba-123' });
    assert.ok(!lines[0]!.includes('EAAzzz999') && !lines[0]!.includes('IGAAsecreto'));
  });
});
