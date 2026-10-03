import { onCleanup } from './cleanup.js';

/** A private temp directory removed after the test. */
export function tmpDir(prefix = 'dl-') {
  const out = Bun.spawnSync(['mktemp', '-d', '-t', `${prefix}XXXXXX`]);
  const dir = out.stdout.toString().trim();
  onCleanup(() => Bun.spawnSync(['rm', '-rf', dir]));
  return dir;
}

export const tmpDbFile = (prefix = 'dl-') => `${tmpDir(prefix)}/log.db`;
