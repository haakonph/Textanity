import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import knex from 'knex';
import { createDatabase } from '@textanity/database';
import { createApp } from '../src/app.js';
import { up as legacyUp } from '../../../packages/database/migrations/202611140001_create_pages.js';
import { up as schemaUp, down as schemaDown } from '../../../packages/database/migrations/202611140002_apps_views_and_translations.js';

// These tests must run against real PostgreSQL, never a mock or a silent skip.
test('apps, page layouts, shared translations, overrides, and ICU work together', async (t) => {
  const database = createDatabase(process.env.DATABASE_URL);
  const app = createApp({ database });
  const suffix = randomUUID();
  const appIds = [];
  let groupId;
  let legacyPageId;
  t.after(async () => {
    try {
      await database.query('DELETE FROM pages WHERE app_id = ANY($1::uuid[]) OR id = $2', [appIds, legacyPageId || null]);
      await database.query('DELETE FROM views WHERE app_id = ANY($1::uuid[])', [appIds]);
      await database.query('DELETE FROM apps WHERE id = ANY($1::uuid[])', [appIds]);
      if (groupId) await database.query('DELETE FROM text_groups WHERE id = $1', [groupId]);
    } finally {
      await app.close();
      await database.end();
    }
  });

  const addApp = async (prefix) => {
    const slug = `${prefix}-${suffix}`;
    const { rows: [row] } = await database.query("INSERT INTO apps (slug, name, default_locale) VALUES ($1, $2, 'nb') RETURNING id", [slug, prefix]);
    appIds.push(row.id);
    return { id: row.id, slug };
  };
  const shop = await addApp('shop');
  const other = await addApp('other');
  const unassigned = await addApp('unassigned');
  const { rows: [page] } = await database.query(
    "INSERT INTO pages (app_id, path, title, body, status) VALUES ($1, '/hello', 'Shop', 'Visible', 'published') RETURNING id", [shop.id],
  );
  await database.query("INSERT INTO pages (app_id, path, title, status) VALUES ($1, '/hello', 'Other', 'published'), ($2, '/draft', 'Private', 'draft')", [other.id, shop.id]);
  const { rows: [view] } = await database.query("INSERT INTO views (app_id, name, type, config) VALUES ($1, 'Hero', 'hero', '{\"theme\":\"light\"}') RETURNING id", [shop.id]);
  const { rows: [foreignView] } = await database.query("INSERT INTO views (app_id, name, type) VALUES ($1, 'Other hero', 'hero') RETURNING id", [other.id]);
  await database.query("INSERT INTO page_views (app_id, page_id, view_id, position, config) VALUES ($1, $2, $3, 2, '{}'), ($1, $2, $3, 0, '{\"title\":\"checkout.submit\"}')", [shop.id, page.id, view.id]);

  const response = await app.inject(`/api/apps/${shop.slug}/pages?path=/hello`);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().title, 'Shop');
  assert.deepEqual(response.json().views.map((item) => item.position), [0, 2]);
  assert.deepEqual(response.json().views[0].view_config, { theme: 'light' });
  assert.deepEqual(response.json().views[0].page_config, { title: 'checkout.submit' });
  assert.equal((await app.inject(`/api/apps/${other.slug}/pages?path=/hello`)).json().title, 'Other');
  assert.equal((await app.inject(`/api/apps/${shop.slug}/pages?path=/draft`)).statusCode, 404);
  assert.equal((await app.inject(`/api/apps/${unassigned.slug}/pages?path=/hello`)).statusCode, 404);
  assert.equal((await app.inject('/api/health/ready')).statusCode, 200);

  await assert.rejects(database.query("INSERT INTO pages (app_id, path, title) VALUES ($1, '/hello', 'Duplicate')", [shop.id]), { code: '23505' });
  await assert.rejects(database.query("INSERT INTO pages (app_id, path, title) VALUES ($1, 'relative', 'Invalid')", [shop.id]), { code: '23514' });
  await assert.rejects(database.query('INSERT INTO page_views (app_id, page_id, view_id, position) VALUES ($1, $2, $3, 1)', [shop.id, page.id, foreignView.id]), { code: '23503' });
  await assert.rejects(database.query('INSERT INTO page_views (app_id, page_id, view_id, position) VALUES ($1, $2, $3, 0)', [shop.id, page.id, view.id]), { code: '23505' });
  await assert.rejects(database.query("UPDATE pages SET status = 'invalid' WHERE id = $1", [page.id]), { code: '23514' });
  const previous = (await database.query('SELECT updated_at FROM pages WHERE id = $1', [page.id])).rows[0].updated_at;
  await database.query("UPDATE pages SET title = 'Updated shop' WHERE id = $1", [page.id]);
  assert.ok((await database.query('SELECT updated_at FROM pages WHERE id = $1', [page.id])).rows[0].updated_at > previous);

  // The compatibility endpoint is limited to the default app.
  const { rows: [legacy] } = await database.query("INSERT INTO pages (app_id, path, title, status) SELECT id, $1, 'Legacy', 'published' FROM apps WHERE slug = 'default' RETURNING id", [`/legacy-${suffix}`]);
  legacyPageId = legacy.id;
  assert.equal((await app.inject(`/api/pages/legacy-${suffix}`)).json().title, 'Legacy');
  assert.equal((await app.inject('/api/pages/hello')).statusCode, 404);

  const groupKey = `checkout_${suffix.replaceAll('-', '')}`;
  groupId = (await database.query('INSERT INTO text_groups (key, name) VALUES ($1, $2) RETURNING id', [groupKey, 'Checkout'])).rows[0].id;
  await database.query('INSERT INTO app_text_groups (app_id, group_id) VALUES ($1, $3), ($2, $3)', [shop.id, other.id, groupId]);
  const keys = ['submit', 'count', 'fallback', 'empty', 'untranslated'];
  const textIds = {};
  for (const key of keys) {
    textIds[key] = (await database.query('INSERT INTO texts (group_id, key) VALUES ($1, $2) RETURNING id', [groupId, key])).rows[0].id;
  }
  const plural = '{count, plural, =0 {Ingen meldinger} one {# melding} other {# meldinger}}';
  const override = '{count, plural, =0 {Ingen varsler} one {# varsel} other {# varsler}}';
  for (const [key, locale, message] of [
    ['submit', 'nb', 'Betal nå'], ['submit', 'en', 'Pay now'],
    ['count', 'nb', plural], ['fallback', 'nb', 'Standardtekst'], ['empty', 'nb', 'Synlig'],
  ]) {
    await database.query('INSERT INTO text_translations (text_id, locale, message) VALUES ($1, $2, $3)', [textIds[key], locale, message]);
  }
  await database.query("INSERT INTO app_text_overrides (app_id, text_id, locale, message) VALUES ($1, $2, 'nb', 'Send bestilling'), ($1, $3, 'nb', $4), ($1, $5, 'nb', '')", [shop.id, textIds.submit, textIds.count, override, textIds.empty]);
  const getGroup = async (target, locale) => app.inject(`/api/apps/${target.slug}/texts/${groupKey}${locale ? `?locale=${locale}` : ''}`);
  const shared = (await getGroup(other, 'nb')).json();
  const customized = (await getGroup(shop, 'nb')).json();
  assert.equal(shared.texts.submit.message, 'Betal nå');
  assert.equal(customized.texts.submit.message, 'Send bestilling');
  assert.equal(customized.texts.submit.isOverride, true);
  assert.equal(customized.texts.empty.message, '');
  assert.deepEqual(customized.texts.untranslated, { locale: null, message: null, isOverride: false });
  assert.equal((await getGroup(unassigned, 'nb')).statusCode, 404);
  const english = (await getGroup(shop, 'en-GB')).json();
  assert.deepEqual(english.locales, ['en-GB', 'en', 'nb']);
  assert.equal(english.texts.submit.message, 'Pay now'); // English shared wins over Norwegian override.
  assert.equal(english.texts.submit.locale, 'en');
  assert.equal(english.texts.fallback.message, 'Standardtekst');
  assert.equal((await getGroup(shop)).json().texts.submit.message, 'Send bestilling');
  assert.equal((await getGroup(shop, 'de')).json().texts.submit.message, 'Send bestilling');

  // App-only language variants also work without a shared translation in that locale.
  await database.query("INSERT INTO app_text_overrides (app_id, text_id, locale, message) VALUES ($1, $2, 'en-GB', 'Place order')", [shop.id, textIds.submit]);
  assert.equal((await getGroup(shop, 'en-GB')).json().texts.submit.message, 'Place order');
  assert.equal((await getGroup(other, 'en-GB')).json().texts.submit.message, 'Pay now');
  await database.query("UPDATE text_translations SET message = 'Ny felles tekst' WHERE text_id = $1 AND locale = 'nb'", [textIds.submit]);
  assert.equal((await getGroup(other, 'nb')).json().texts.submit.message, 'Ny felles tekst');
  assert.equal((await getGroup(shop, 'nb')).json().texts.submit.message, 'Send bestilling');
  await database.query("DELETE FROM app_text_overrides WHERE app_id = $1 AND text_id = $2 AND locale = 'nb'", [shop.id, textIds.submit]);
  assert.equal((await getGroup(shop, 'nb')).json().texts.submit.message, 'Ny felles tekst');

  const format = async (key, variables) => app.inject({ method: 'POST', url: `/api/apps/${shop.slug}/texts/${groupKey}/${key}/format?locale=nb`, payload: { variables } });
  for (const [count, expected] of [[0, 'Ingen varsler'], [1, '1 varsel'], [2, '2 varsler']]) {
    const formatted = await format('count', { count });
    assert.equal(formatted.statusCode, 200);
    assert.equal(formatted.json().message, expected);
  }
  assert.equal((await format('count', {})).statusCode, 400);
  assert.equal((await format('count', { count: 'bad' })).statusCode, 400);
  assert.equal((await format('untranslated', {})).statusCode, 404);
  assert.equal((await format('constructor', {})).statusCode, 404);
  assert.equal((await format('empty', {})).json().message, '');

  await assert.rejects(database.query("INSERT INTO texts (group_id, key) VALUES ($1, 'submit')", [groupId]), { code: '23505' });
  await assert.rejects(database.query("INSERT INTO text_translations (text_id, locale, message) VALUES ($1, 'nb', 'Duplicate')", [textIds.submit]), { code: '23505' });
  await assert.rejects(database.query("INSERT INTO app_text_overrides (app_id, text_id, locale, message) VALUES ($1, $2, 'nb', NULL)", [shop.id, textIds.submit]), { code: '23502' });
  await assert.rejects(database.query("INSERT INTO text_translations (text_id, locale, message) VALUES ($1, 'en_US', 'Invalid')", [textIds.submit]), { code: '23514' });
});

test('migration preserves legacy data and refuses a lossy downgrade', async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db = knex({ client: 'pg', connection: process.env.DATABASE_URL, pool: { min: 0, max: 1 } });
  const schema = `migration_${randomUUID().replaceAll('-', '')}`;
  try {
    await db.transaction(async (trx) => {
      await trx.raw('CREATE SCHEMA ??', [schema]);
      await trx.raw('SET LOCAL search_path TO ??', [schema]);
      await legacyUp(trx);
      await trx('pages').insert({ slug: 'legacy-page', title: 'Existing title', body: 'Preserve this content', status: 'published' });
      await schemaUp(trx);
      const page = await trx('pages').first();
      assert.equal(page.path, '/legacy-page');
      assert.equal(page.body, 'Preserve this content');
      assert.equal(page.app_id, (await trx('apps').where('slug', 'default').first()).id);
      await schemaDown(trx);
      assert.equal((await trx('pages').first()).slug, 'legacy-page');
      await schemaUp(trx);
      await trx('apps').insert({ slug: 'second-app', name: 'Second app' });
      await assert.rejects(trx.transaction(async (savepoint) => schemaDown(savepoint)), /Cannot roll back/);
      assert.equal((await trx('pages').first()).body, 'Preserve this content');
      await trx.raw('DROP SCHEMA ?? CASCADE', [schema]);
    });
  } finally {
    await db.destroy();
  }
});
