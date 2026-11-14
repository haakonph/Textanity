import knex from 'knex';
import { fileURLToPath } from 'node:url';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const action = process.argv[2];
if (!['latest', 'rollback'].includes(action)) throw new Error('Use latest or rollback');

const db = knex({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  pool: { min: 0, max: 2 },
  migrations: {
    directory: fileURLToPath(new URL('../migrations/', import.meta.url)),
    loadExtensions: ['.js'],
  },
});

try {
  const [batch, files] = await db.migrate[action]();
  console.log(`Migration batch ${batch}: ${files.length} file(s)`);
} finally {
  await db.destroy();
}
