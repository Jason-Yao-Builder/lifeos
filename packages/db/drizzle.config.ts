import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';
import { defaultDatabaseFilename } from './src/paths.js';

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
const configured = process.env.DATABASE_URL?.replace(/^file:/, '');

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: configured ? resolve(workspaceRoot, configured) : defaultDatabaseFilename(),
  },
});
