// Diagnóstico de credenciales de Instagram: tipo de token, cuenta, permisos y cupo.
// Solo consulta (no publica nada) y nunca imprime el token.

import { redact, registerSecret } from '../core/logger.ts';
import { detectTokenKind, graphHost } from './instagram.ts';

export interface DiagnosticLine {
  ok: boolean;
  label: string;
  detail: string;
}

export async function diagnoseInstagram(env: NodeJS.ProcessEnv, version: string, fetchImpl: typeof fetch = fetch): Promise<DiagnosticLine[]> {
  const lines: DiagnosticLine[] = [];
  const token = env.IG_ACCESS_TOKEN?.trim();
  const userId = env.IG_USER_ID?.trim();
  if (!token) return [{ ok: false, label: 'Token', detail: 'IG_ACCESS_TOKEN no está definido' }];
  registerSecret(token);
  const kind = detectTokenKind(token);
  if (!kind) return [{ ok: false, label: 'Token', detail: 'Formato no reconocido (se espera IGAA… o EAA…)' }];
  const base = `${graphHost(kind)}/${version}`;
  lines.push({ ok: true, label: 'Token', detail: `${kind === 'instagram-login' ? 'Inicio de sesión con Instagram (IGAA…)' : 'Inicio de sesión con Facebook (EAA…)'} → ${graphHost(kind)}` });

  const get = async (path: string, params: Record<string, string>) => {
    const qs = new URLSearchParams({ ...params, access_token: token });
    const res = await fetchImpl(`${base}${path}?${qs}`, { signal: AbortSignal.timeout(20_000) });
    const json = (await res.json()) as Record<string, unknown> & { error?: { message?: string; code?: number } };
    if (!res.ok || json.error) throw new Error(redact(`${json.error?.code ?? res.status}: ${json.error?.message ?? 'error'}`));
    return json;
  };

  try {
    if (kind === 'instagram-login') {
      const me = await get('/me', { fields: 'user_id,username,account_type' });
      lines.push({ ok: true, label: 'Cuenta', detail: `@${me.username} (id ${me.user_id}, ${me.account_type ?? 'tipo desconocido'})` });
      if (userId && String(me.user_id) !== userId) lines.push({ ok: false, label: 'IG_USER_ID', detail: `No coincide con la cuenta del token (${me.user_id})` });
    } else {
      const pages = await get('/me/accounts', { fields: 'name,instagram_business_account' });
      const data = (pages.data as { name: string; instagram_business_account?: { id: string } }[] | undefined) ?? [];
      for (const p of data) lines.push({ ok: Boolean(p.instagram_business_account), label: `Página ${p.name}`, detail: p.instagram_business_account ? `IG_USER_ID = ${p.instagram_business_account.id}` : 'sin cuenta de Instagram vinculada' });
      try {
        const dbg = await get('/debug_token', { input_token: token });
        const d = dbg.data as { expires_at?: number; scopes?: string[]; is_valid?: boolean } | undefined;
        if (d) {
          lines.push({ ok: Boolean(d.is_valid), label: 'Validez', detail: d.expires_at ? `vence el ${new Date(d.expires_at * 1000).toISOString().slice(0, 10)}` : 'no vence' });
          if (d.scopes) lines.push({ ok: d.scopes.includes('instagram_content_publish'), label: 'Permisos', detail: d.scopes.join(', ') });
        }
      } catch (err) {
        lines.push({ ok: true, label: 'Validez', detail: `no se pudo consultar (${String(err)})` });
      }
    }
  } catch (err) {
    lines.push({ ok: false, label: 'Cuenta', detail: String(err) });
    return lines;
  }

  if (!userId) {
    lines.push({ ok: false, label: 'IG_USER_ID', detail: 'no está definido' });
    return lines;
  }
  try {
    const quota = await get(`/${userId}/content_publishing_limit`, { fields: 'quota_usage,config' });
    const entry = (quota.data as { quota_usage?: number; config?: { quota_total?: number } }[] | undefined)?.[0];
    lines.push({ ok: true, label: 'Cupo 24 h', detail: `${entry?.quota_usage ?? '?'} de ${entry?.config?.quota_total ?? '?'} publicaciones usadas` });
  } catch (err) {
    lines.push({ ok: false, label: 'Cupo 24 h', detail: String(err) });
  }
  return lines;
}
