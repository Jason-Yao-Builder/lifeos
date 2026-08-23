import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../database.js';

const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const configured = process.env.DATABASE_URL?.replace(/^file:/, '');
const filename = configured === ':memory:' ? configured : resolve(workspaceRoot, configured ?? 'data/lifeos.db');
const database = createDatabase({ filename, autoSeed: false });
database.close();
console.log('Database migrations applied.');
