// Cola persistente de publicaciones en SQLite: alta idempotente, reemplazo de versiones
// viejas de una misma serie, vencimiento, selección por prioridad y límite diario.

import type { PostKind } from '../core/config.ts';
import { toLocal } from '../core/time.ts';
import { many, nowIso, one, run, transaction, type Db } from '../db/connection.ts';
import type { Candidate } from './planner.ts';

export type PostStatus = 'pending' | 'rendered' | 'published' | 'failed' | 'skipped' | 'expired';

export interface MediaFile {
  format: 'vertical' | 'cuadrado';
  /** Posición en el carrusel (1 si es una sola imagen). */
  slide?: number;
  png: string;
  jpg?: string;
}

export interface PostRow {
  id: number;
  kind: PostKind;
  dedupe_key: string;
  competition_code: string;
  season: number;
  subject: string;
  priority: number;
  status: PostStatus;
  scheduled_for: string;
  expires_at: string | null;
  series: string | null;
  fingerprint: string | null;
  caption: string | null;
  alt_text: string | null;
  situation: string | null;
  media: string | null;
  attempts: number;
  last_error: string | null;
  mode: string | null;
  external_id: string | null;
  permalink: string | null;
  note: string | null;
  created_at: string;
  published_at: string | null;
}

export const MAX_ATTEMPTS = 3;

export class PostQueue {
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Alta idempotente por dedupe_key. Si es de una serie, retira las versiones pendientes anteriores. */
  enqueue(c: Candidate): { inserted: boolean; superseded: number } {
    return transaction(this.#db, () => {
      const now = nowIso();
      const res = run(
        this.#db,
        `INSERT INTO posts (kind, dedupe_key, competition_code, season, subject, priority, status, scheduled_for,
           expires_at, series, fingerprint, note, created_at, updated_at)
         VALUES (:kind, :key, :code, :season, :subject, :priority, 'pending', :scheduled, :expires, :series, :fp, :note, :now, :now)
         ON CONFLICT(dedupe_key) DO NOTHING`,
        {
          kind: c.kind,
          key: c.dedupeKey,
          code: c.competitionCode,
          season: c.season,
          subject: JSON.stringify(c.subject),
          priority: c.priority,
          scheduled: c.scheduledFor,
          expires: c.expiresAt,
          series: c.series ?? null,
          fp: c.fingerprint ?? null,
          note: c.reason,
          now,
        },
      );
      let superseded = 0;
      if (res.changes > 0 && c.series) {
        superseded = run(
          this.#db,
          `UPDATE posts SET status = 'skipped', note = 'Reemplazada por una versión más reciente', updated_at = :now
           WHERE series = :series AND status IN ('pending', 'rendered') AND dedupe_key <> :key`,
          { series: c.series, key: c.dedupeKey, now },
        ).changes;
      }
      return { inserted: res.changes > 0, superseded };
    });
  }

  /** Marca como vencidas las publicaciones que ya no tienen sentido (p. ej. una previa tras el inicio). */
  expire(now: string): number {
    return run(
      this.#db,
      `UPDATE posts SET status = 'expired', updated_at = :now
       WHERE status IN ('pending', 'rendered') AND expires_at IS NOT NULL AND expires_at <= :now`,
      { now },
    ).changes;
  }

  toRender(now: string): PostRow[] {
    return many<PostRow>(this.#db, `SELECT * FROM posts WHERE status = 'pending' AND scheduled_for <= :now ORDER BY priority, scheduled_for, id`, { now });
  }

  /**
   * Publicaciones listas para salir. En modo real también entran las que solo se publicaron
   * en simulación: probar con DRY_RUN no debe impedir publicarlas de verdad (si no vencieron).
   */
  dueForPublishing(now: string, limit: number, mode: 'dry-run' | 'instagram' = 'dry-run'): PostRow[] {
    if (limit <= 0) return [];
    return many<PostRow>(
      this.#db,
      `SELECT * FROM posts
       WHERE (status = 'rendered' OR (:real = 1 AND status = 'published' AND mode = 'dry-run'))
         AND scheduled_for <= :now AND (expires_at IS NULL OR expires_at > :now)
       ORDER BY priority, scheduled_for, id LIMIT :limit`,
      { now, limit, real: mode === 'instagram' ? 1 : 0 },
    );
  }

  /** Publicaciones hechas en la fecha local indicada (zona de Ecuador), contadas por modo. */
  publishedOn(localDate: string, timeZone: string, mode: 'dry-run' | 'instagram' = 'dry-run'): number {
    const since = new Date(Date.parse(`${localDate}T00:00:00Z`) - 2 * 86_400_000).toISOString();
    return many<{ published_at: string }>(
      this.#db,
      `SELECT published_at FROM posts WHERE status = 'published' AND mode = :mode AND published_at >= :since`,
      { since, mode },
    ).filter((r) => toLocal(r.published_at, timeZone).date === localDate).length;
  }

  markRendered(id: number, data: { caption: string; altText: string; situation: string; media: MediaFile[]; fingerprint?: string }): void {
    run(
      this.#db,
      `UPDATE posts SET status = 'rendered', caption = :caption, alt_text = :alt, situation = :situation, media = :media,
         fingerprint = COALESCE(:fp, fingerprint), rendered_at = :now, updated_at = :now WHERE id = :id`,
      { id, caption: data.caption, alt: data.altText, situation: data.situation, media: JSON.stringify(data.media), fp: data.fingerprint ?? null, now: nowIso() },
    );
  }

  markPublished(id: number, result: { mode: string; externalId: string; permalink?: string }): void {
    const now = nowIso();
    transaction(this.#db, () => {
      run(
        this.#db,
        `UPDATE posts SET status = 'published', mode = :mode, external_id = :ext, permalink = :link, published_at = :now,
           last_error = NULL, updated_at = :now WHERE id = :id`,
        { id, mode: result.mode, ext: result.externalId, link: result.permalink ?? null, now },
      );
      const post = one<{ series: string | null; fingerprint: string | null }>(this.#db, 'SELECT series, fingerprint FROM posts WHERE id = :id', { id });
      if (post?.series && post.fingerprint) {
        run(
          this.#db,
          `INSERT INTO content_snapshots (series, fingerprint, post_id, updated_at) VALUES (:s, :f, :id, :now)
           ON CONFLICT(series) DO UPDATE SET fingerprint = excluded.fingerprint, post_id = excluded.post_id, updated_at = excluded.updated_at`,
          { s: post.series, f: post.fingerprint, id, now },
        );
      }
    });
  }

  /**
   * Registra un fallo. Los reintentables vuelven a intentarse hasta MAX_ATTEMPTS;
   * los definitivos (o con estado incierto) quedan como 'failed' para revisión manual.
   */
  markFailed(id: number, error: string, retryable: boolean, stage: 'render' | 'publish'): PostStatus {
    const row = one<{ attempts: number }>(this.#db, 'SELECT attempts FROM posts WHERE id = :id', { id });
    const attempts = (row?.attempts ?? 0) + 1;
    const status: PostStatus = retryable && attempts < MAX_ATTEMPTS ? (stage === 'render' ? 'pending' : 'rendered') : 'failed';
    run(this.#db, 'UPDATE posts SET status = :status, attempts = :a, last_error = :e, updated_at = :now WHERE id = :id', {
      id,
      status,
      a: attempts,
      e: error.slice(0, 1000),
      now: nowIso(),
    });
    return status;
  }

  skip(id: number, note: string): void {
    run(this.#db, `UPDATE posts SET status = 'skipped', note = :note, updated_at = :now WHERE id = :id`, { id, note, now: nowIso() });
  }

  snapshots(): Map<string, string> {
    return new Map(many<{ series: string; fingerprint: string }>(this.#db, 'SELECT series, fingerprint FROM content_snapshots').map((r) => [r.series, r.fingerprint]));
  }

  list(statuses: PostStatus[], limit = 50): PostRow[] {
    return many<PostRow>(
      this.#db,
      `SELECT * FROM posts WHERE status IN (${statuses.map((s) => `'${s}'`).join(',')}) ORDER BY
         CASE status WHEN 'rendered' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, priority, scheduled_for DESC LIMIT :limit`,
      { limit },
    );
  }

  get(id: number): PostRow | undefined {
    return one<PostRow>(this.#db, 'SELECT * FROM posts WHERE id = :id', { id });
  }
}
