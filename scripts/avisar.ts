// Envía un aviso suelto por ntfy / Telegram sin abrir la base de datos ni la configuración,
// para que funcione aunque lo que haya fallado sea justamente eso.
//
//   node scripts/avisar.ts --titulo "…" --mensaje "…" [--url https://…] [--prioridad alta]

import { flagString, parseArgs } from '../src/cli/args.ts';
import { createLogger } from '../src/core/logger.ts';
import { createNotifiers, notifyAll } from '../src/notify/notifier.ts';

const args = parseArgs(['avisar', ...process.argv.slice(2)]);
const title = flagString(args, 'titulo');
const message = flagString(args, 'mensaje');
if (!title || !message) {
  console.error('Uso: node scripts/avisar.ts --titulo "…" --mensaje "…" [--url …] [--prioridad alta]');
  process.exit(2);
}
const notifiers = createNotifiers();
if (notifiers.length === 0) {
  console.log('Sin canales de aviso configurados: no se envía nada.');
  process.exit(0);
}
const { sent, failed } = await notifyAll(
  notifiers,
  { title, message, url: flagString(args, 'url'), priority: flagString(args, 'prioridad') === 'alta' ? 'high' : 'default' },
  createLogger({ level: 'info' }),
);
console.log(`Aviso enviado por: ${sent.join(', ') || 'ninguno'}${failed.length ? ` · con error: ${failed.join(', ')}` : ''}`);
process.exit(sent.length ? 0 : 1);
