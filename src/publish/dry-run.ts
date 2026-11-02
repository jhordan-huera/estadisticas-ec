// Modo simulación (DRY_RUN, activo por defecto): no publica nada. Copia la imagen,
// el texto y los metadatos a una carpeta local para revisarlos como si se hubieran publicado.

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { localToday } from '../core/time.ts';
import type { Publisher, PublishRequest, PublishResult } from './types.ts';

export class DryRunPublisher implements Publisher {
  readonly mode = 'dry-run' as const;
  #dir: string;
  #timeZone: string;

  constructor(outDir: string, timeZone: string) {
    this.#dir = join(outDir, 'dry-run');
    this.#timeZone = timeZone;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const dayDir = join(this.#dir, localToday(new Date(), this.#timeZone));
    mkdirSync(dayDir, { recursive: true });
    const stem = `${String(req.postId).padStart(5, '0')}-${req.kind}`;
    const copies = req.images.map((img, i) => {
      const name = `${stem}${req.images.length > 1 ? `-${i + 1}` : ''}${extname(img.path)}`;
      copyFileSync(img.path, join(dayDir, name));
      return { file: name, source: basename(img.path), url: img.url ?? null };
    });
    writeFileSync(join(dayDir, `${stem}.txt`), req.caption + '\n');
    writeFileSync(
      join(dayDir, `${stem}.json`),
      JSON.stringify({ postId: req.postId, kind: req.kind, type: req.images.length > 1 ? 'carrusel' : 'imagen', images: copies, altText: req.altText ?? null, simulatedAt: new Date().toISOString() }, null, 2) + '\n',
    );
    return { mode: this.mode, externalId: `dry-run-${req.postId}` };
  }
}
