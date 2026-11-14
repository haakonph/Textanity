import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '@textanity/database';
import { createApp } from '../src/app.js';

// Intentionally fails without DATABASE_URL: this target must exercise real PostgreSQL.
test('PostgreSQL schema and API enforce publishing rules', async (t) => {
  const database = createDatabase(process.env.DATABASE_URL);
  const app = createApp({ database });
  const publishedSlug = `published-${randomUUID()}`;
  const draftSlug = `draft-${randomUUID()}`;
  t.after(async () => {
    try {
      await database.query('DELETE FROM pages WHERE slug = ANY($1::text[])', [[publishedSlug, draftSlug]]);
    } finally {
      await app.close();
      await database.end();
    }
  });

  await database.query(
    'INSERT INTO pages (slug, title, body, status) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)',
    [publishedSlug, 'Published page', 'Visible content', 'published', draftSlug, 'Draft', 'Private content', 'draft'],
  );
  assert.equal((await app.inject('/api/health/ready')).statusCode, 200);
  const published = await app.inject(`/api/pages/${publishedSlug}`);
  assert.equal(published.statusCode, 200);
  assert.equal(published.json().body, 'Visible content');
  assert.equal((await app.inject(`/api/pages/${draftSlug}`)).statusCode, 404);
  assert.equal((await app.inject('/api/pages/nonexistent-page')).statusCode, 404);
  await assert.rejects(
    database.query('INSERT INTO pages (slug, title, status) VALUES ($1, $2, $3)', [publishedSlug, 'Duplicate', 'published']),
    { code: '23505' },
  );
  await assert.rejects(
    database.query('UPDATE pages SET status = $1 WHERE slug = $2', ['invalid', draftSlug]),
    { code: '23514' },
  );
});
