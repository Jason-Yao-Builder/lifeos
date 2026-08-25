import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../database.js';
import { defaultDatabaseFilename } from '../paths.js';

const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const configured = process.env.DATABASE_URL?.replace(/^file:/, '');
const filename = configured === ':memory:'
  ? configured
  : configured
    ? resolve(workspaceRoot, configured)
    : defaultDatabaseFilename();
const database = createDatabase({ filename, autoSeed: false });
database.close();
console.log('Database migrations applied.');
