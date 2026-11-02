import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nullLogger } from '../../src/core/logger.ts';
import { detectTokenKind, graphHost, InstagramGraphPublisher } from '../../src/publish/instagram.ts';
import { PublishError } from '../../src/publish/types.ts';

const TOKEN = 'IGAAtoken-de-prueba-que-no-debe-filtrarse';

type Handler = (url: string, init: RequestInit | undefined) => Response;

function graph(handler: Handler) {
  const calls: { url: string; method: string; body: string }[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? String(init.body) : '' });
    return handler(url, init);
  }) as unknown as typeof fetch;
  const publisher = new InstagramGraphPublisher({ userId: '17841', accessToken: TOKEN, version: 'v23.0', sendAltText: false, logger: nullLogger, fetchImpl, sleep: async () => {}, pollIntervalMs: 0, maxPolls: 3 });
  return { publisher, calls };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const image = () => new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg' } });
const url = (n: number) => `https://raw.githubusercontent.com/u/r/estado/media/x-${n}.jpg`;
const request = { postId: 1, kind: 'resultado', caption: 'Texto', images: [{ path: '/tmp/x.jpg', url: url(1) }] };

describe('publicador de Instagram', () => {
  it('detecta el host por el tipo de token', () => {
    assert.equal(graphHost(detectTokenKind('IGAAxyz')!), 'https://graph.instagram.com');
    assert.equal(graphHost(detectTokenKind('EAAxyz')!), 'https://graph.facebook.com');
    assert.equal(detectTokenKind('otro'), undefined);
  });

  it('publica en dos pasos: contenedor → espera → media_publish → enlace', async () => {
    let polls = 0;
    const { publisher, calls } = graph((url, init) => {
      if (init?.method === 'HEAD') return image();
      if (url.endsWith('/17841/media')) return ok({ id: 'C1' });
      if (url.includes('/C1?')) return ok({ status_code: ++polls < 2 ? 'IN_PROGRESS' : 'FINISHED' });
      if (url.endsWith('/media_publish')) return ok({ id: 'M1' });
      if (url.includes('/M1?')) return ok({ permalink: 'https://instagram.com/p/abc' });
      throw new Error(`URL inesperada ${url}`);
    });
    const res = await publisher.publish(request);
    assert.deepEqual(res, { mode: 'instagram', externalId: 'M1', permalink: 'https://instagram.com/p/abc' });
    assert.ok(calls.every((c) => c.url.startsWith('https://graph.instagram.com/v23.0') || c.method === 'HEAD'));
    const create = calls.find((c) => c.url.endsWith('/media'))!;
    assert.match(create.body, /image_url=https%3A%2F%2Fraw.githubusercontent.com/);
  });

  it('publica un carrusel: un contenedor por imagen, uno padre con el texto y una sola publicación', async () => {
    let item = 0;
    const { publisher, calls } = graph((u, init) => {
      if (init?.method === 'HEAD') return image();
      if (u.endsWith('/17841/media')) {
        const body = new URLSearchParams(String(init?.body));
        return ok({ id: body.get('media_type') === 'CAROUSEL' ? 'PARENT' : `ITEM${++item}` });
      }
      if (/\/(ITEM\d|PARENT)\?/.test(u)) return ok({ status_code: 'FINISHED' });
      if (u.endsWith('/media_publish')) return ok({ id: 'M9' });
      return ok({ permalink: 'https://instagram.com/p/xyz' });
    });
    const res = await publisher.publish({ ...request, kind: 'duelo', images: [1, 2, 3].map((n) => ({ path: `/tmp/${n}.jpg`, url: url(n) })) });
    assert.equal(res.externalId, 'M9');
    const creates = calls.filter((c) => c.url.endsWith('/17841/media')).map((c) => new URLSearchParams(c.body));
    assert.equal(creates.length, 4);
    assert.ok(creates.slice(0, 3).every((b) => b.get('is_carousel_item') === 'true' && !b.get('caption')));
    assert.equal(creates[3]!.get('children'), 'ITEM1,ITEM2,ITEM3');
    assert.equal(creates[3]!.get('caption'), 'Texto');
    assert.equal(calls.filter((c) => c.url.endsWith('/media_publish')).length, 1);
  });

  it('no llama a Instagram si la imagen no es accesible públicamente', async () => {
    const { publisher, calls } = graph(() => new Response('no', { status: 404, headers: { 'content-type': 'text/plain' } }));
    await assert.rejects(publisher.publish(request), (e: unknown) => e instanceof PublishError && e.code === 'IMAGE_URL_UNREACHABLE' && e.retryable);
    assert.equal(calls.length, 1);
  });

  it('un token inválido (190) detiene la tanda y no aparece en el mensaje', async () => {
    const { publisher } = graph((_u, init) =>
      init?.method === 'HEAD' ? image() : new Response(JSON.stringify({ error: { code: 190, message: `Invalid token ${TOKEN}` } }), { status: 400 }),
    );
    await assert.rejects(publisher.publish(request), (e: unknown) => e instanceof PublishError && e.fatal && !e.message.includes(TOKEN));
  });

  it('si la red cae al publicar, el resultado queda como incierto y no se reintenta', async () => {
    const { publisher } = graph((url, init) => {
      if (init?.method === 'HEAD') return image();
      if (url.endsWith('/17841/media')) return ok({ id: 'C1' });
      if (url.includes('/C1?')) return ok({ status_code: 'FINISHED' });
      throw new TypeError('socket hang up');
    });
    await assert.rejects(publisher.publish(request), (e: unknown) => e instanceof PublishError && e.uncertain && !e.retryable);
  });

  it('informa un contenedor rechazado por Instagram', async () => {
    const { publisher } = graph((url, init) => {
      if (init?.method === 'HEAD') return image();
      if (url.endsWith('/17841/media')) return ok({ id: 'C1' });
      return ok({ status_code: 'ERROR', status: 'Formato no admitido' });
    });
    await assert.rejects(publisher.publish(request), /Formato no admitido/);
  });
});
