import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Minimal .env reader. Avoids a dependency and keeps secrets out of the
 * committed config file, which only holds non-secret wiring.
 */
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

const fileEnv = {
  ...parseEnvFile(resolve(REPO_ROOT, '.env')),
  ...parseEnvFile(resolve(REPO_ROOT, '.env.local')),
};

export function env(key: string, fallback = ''): string {
  return process.env[key] ?? fileEnv[key] ?? fallback;
}

export function hasEnv(key: string): boolean {
  return Boolean(env(key));
}
