import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../database.js';

const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const configured = process.env.DATABASE_URL?.replace(/^file:/, '');
const filename = configured === ':memory:' ? configured : resolve(workspaceRoot, configured ?? 'data/lifeos.db');
const database = createDatabase({ filename });
database.close();
console.log('Default workspace, user, and rules seeded.');
