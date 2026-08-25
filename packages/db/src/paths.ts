import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export interface LifeOSDataPathOptions {
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  workingDirectory?: string;
}

export function defaultLifeOSDataDirectory(options: LifeOSDataPathOptions = {}): string {
  const env = options.env ?? process.env;
  const configured = env.LIFEOS_DATA_DIR?.trim();
  if (configured) {
    return isAbsolute(configured)
      ? configured
      : resolve(options.workingDirectory ?? process.cwd(), configured);
  }

  const home = options.homeDirectory ?? homedir();
  const platform = options.platform ?? process.platform;
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'LifeOS');
  if (platform === 'win32') {
    return join(env.APPDATA?.trim() || join(home, 'AppData', 'Roaming'), 'LifeOS');
  }
  return join(env.XDG_DATA_HOME?.trim() || join(home, '.local', 'share'), 'lifeos');
}

export function defaultDatabaseFilename(options: LifeOSDataPathOptions = {}): string {
  return join(defaultLifeOSDataDirectory(options), 'lifeos.db');
}
