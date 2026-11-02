import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createLogger } from '../../src/core/logger.ts';
import { createNotifiers, notifyAll, NtfyNotifier, TelegramNotifier } from '../../src/notify/notifier.ts';

function recorder(status: number | ((url: string) => number) = 200) {
  const calls: { url: string; body: Record<string, unknown>; form?: FormData; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const form = init?.body instanceof FormData ? init.body : undefined;
    calls.push({ url, body: form ? {} : JSON.parse(String(init?.body)), form, headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response('{}', { status: typeof status === 'function' ? status(url) : status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const dir = mkdtempSync(join(tmpdir(), 'avisos-'));
const jpg = (name: string) => {
  const path = join(dir, name);
  writeFileSync(path, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  return path;
};

describe('avisos', () => {
  it('ntfy: publica en JSON con título, enlace y prioridad', async () => {
    const { calls, fetchImpl } = recorder();
    await new NtfyNotifier('https://ntfy.sh/', 'mi-tema', undefined, fetchImpl).send({ title: 'Publicado: Resultado', message: 'Goleada', url: 'https://instagram.com/p/x' });
    assert.equal(calls[0]!.url, 'https://ntfy.sh');
    assert.deepEqual([calls[0]!.body.topic, calls[0]!.body.title, calls[0]!.body.click, calls[0]!.body.priority], ['mi-tema', 'Publicado: Resultado', 'https://instagram.com/p/x', 3]);
  });

  it('telegram: envía el mensaje al chat configurado', async () => {
    const { calls, fetchImpl } = recorder();
    await new TelegramNotifier('123:token-secreto-largo', '987', fetchImpl).send({ title: 'Error al publicar', message: 'Token vencido', priority: 'high' });
    assert.equal(calls[0]!.url, 'https://api.telegram.org/bot123:token-secreto-largo/sendMessage');
    assert.equal(calls[0]!.body.chat_id, '987');
    assert.match(String(calls[0]!.body.text), /^⚠️ Error al publicar\n\nToken vencido$/);
  });

  it('telegram: una imagen va como foto con el texto como pie', async () => {
    const { calls, fetchImpl } = recorder();
    await new TelegramNotifier('123:token-secreto-largo', '987', fetchImpl).send({ title: 'Publicado: Resultado', message: 'Goleada', images: [{ path: jpg('r.jpg') }] });
    assert.match(calls[0]!.url, /\/sendPhoto$/);
    assert.equal(calls[0]!.form!.get('chat_id'), '987');
    assert.match(String(calls[0]!.form!.get('caption')), /Publicado: Resultado/);
    assert.ok(calls[0]!.form!.get('photo') instanceof Blob);
  });

  it('telegram: un carrusel va como álbum, con el texto en la primera imagen', async () => {
    const { calls, fetchImpl } = recorder();
    const images = ['1', '2', '3'].map((n) => ({ path: jpg(`d${n}.jpg`) }));
    await new TelegramNotifier('123:token-secreto-largo', '987', fetchImpl).send({ title: 'Publicado: Previa', message: 'Orense vs Técnico U.', images });
    assert.match(calls[0]!.url, /\/sendMediaGroup$/);
    const media = JSON.parse(String(calls[0]!.form!.get('media'))) as { media: string; caption?: string }[];
    assert.deepEqual(media.map((m) => m.media), ['attach://foto0', 'attach://foto1', 'attach://foto2']);
    assert.ok(media[0]!.caption && !media[1]!.caption);
  });

  it('telegram: si las fotos fallan, el aviso llega igual en texto y se informa', async () => {
    const { calls, fetchImpl } = recorder((url) => (url.endsWith('/sendPhoto') ? 400 : 200));
    await assert.rejects(
      new TelegramNotifier('123:token-secreto-largo', '987', fetchImpl).send({ title: 'x', message: 'y', images: [{ path: jpg('f.jpg') }] }),
      /solo en texto/,
    );
    assert.deepEqual(calls.map((c) => c.url.split('/').at(-1)), ['sendPhoto', 'sendMessage']);
  });

  it('ntfy: adjunta la primera imagen por su URL pública', async () => {
    const { calls, fetchImpl } = recorder();
    await new NtfyNotifier('https://ntfy.sh', 't', undefined, fetchImpl).send({ title: 'x', message: 'y', images: [{ path: '/m/a-1.jpg', url: 'https://raw.example/a-1.jpg' }] });
    assert.deepEqual([calls[0]!.body.attach, calls[0]!.body.filename], ['https://raw.example/a-1.jpg', 'a-1.jpg']);
  });

  it('solo activa los canales con sus variables completas', () => {
    assert.deepEqual(createNotifiers({}).map((n) => n.name), []);
    assert.deepEqual(createNotifiers({ NTFY_TOPIC: 'tema-de-prueba', TELEGRAM_BOT_TOKEN: 'sin-chat-id' }).map((n) => n.name), ['ntfy']);
    assert.deepEqual(createNotifiers({ TELEGRAM_BOT_TOKEN: 'abc:def-123456', TELEGRAM_CHAT_ID: '1' }).map((n) => n.name), ['telegram']);
  });

  it('un aviso fallido no interrumpe nada y no filtra el token', async () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'warn', write: (l) => lines.push(l) });
    const ok = recorder(200);
    const ko = (async () => {
      throw new Error('fallo en https://api.telegram.org/bot999:token-muy-secreto/sendMessage');
    }) as unknown as typeof fetch;
    const res = await notifyAll([new NtfyNotifier('https://ntfy.sh', 't', undefined, ok.fetchImpl), new TelegramNotifier('999:token-muy-secreto', '1', ko)], { title: 'x', message: 'y' }, logger);
    assert.deepEqual(res, { sent: ['ntfy'], failed: ['telegram'] });
    assert.ok(lines.length === 1 && !lines[0]!.includes('token-muy-secreto'));
  });
});
