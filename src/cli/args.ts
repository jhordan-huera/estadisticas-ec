export interface ParsedArgs {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string | true>;
}

/** Argumentos de la forma: comando [posicionales] [--bandera valor | --bandera]. */
export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split('=', 2) as [string, string | undefined];
    const next = rest[i + 1];
    if (inline !== undefined) flags[name] = inline;
    else if (next !== undefined && !next.startsWith('--')) {
      flags[name] = next;
      i++;
    } else flags[name] = true;
  }
  return { command, positional, flags };
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
  const v = args.flags[name];
  return typeof v === 'string' ? v : undefined;
}

export function flagInt(args: ParsedArgs, name: string): number | undefined {
  const v = flagString(args, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`--${name} debe ser un número entero`);
  return n;
}
