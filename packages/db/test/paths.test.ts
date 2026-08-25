import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { defaultDatabaseFilename, defaultLifeOSDataDirectory } from '../src/paths.js';

describe('LifeOS user data paths', () => {
  it('uses the native per-user data directory on each operating system', () => {
    expect(defaultDatabaseFilename({ platform: 'darwin', homeDirectory: '/Users/yin' })).toBe(
      '/Users/yin/Library/Application Support/LifeOS/lifeos.db',
    );
    expect(defaultDatabaseFilename({
      platform: 'win32',
      homeDirectory: 'C:\\Users\\yin',
      env: { APPDATA: 'D:\\Profiles\\yin' },
    })).toBe(join('D:\\Profiles\\yin', 'LifeOS', 'lifeos.db'));
    expect(defaultDatabaseFilename({ platform: 'linux', homeDirectory: '/home/yin' })).toBe(
      '/home/yin/.local/share/lifeos/lifeos.db',
    );
  });

  it('supports XDG and an explicit LIFEOS_DATA_DIR override', () => {
    expect(
      defaultLifeOSDataDirectory({
        platform: 'linux',
        homeDirectory: '/home/yin',
        env: { XDG_DATA_HOME: '/data/yin' },
      }),
    ).toBe('/data/yin/lifeos');
    expect(
      defaultDatabaseFilename({
        platform: 'darwin',
        homeDirectory: '/Users/yin',
        workingDirectory: '/workspace',
        env: { LIFEOS_DATA_DIR: './private-data' },
      }),
    ).toBe('/workspace/private-data/lifeos.db');
  });
});
