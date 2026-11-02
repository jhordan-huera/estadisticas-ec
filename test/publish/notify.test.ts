import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLogger } from '../../src/core/logger.ts';
import { createNotifiers, notifyAll, NtfyNotifier, TelegramNotifier } from '../../src/notify/notifier.ts';

function recorder(status = 200) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response('{}', { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

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
