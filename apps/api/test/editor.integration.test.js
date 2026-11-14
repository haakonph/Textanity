import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import knex from 'knex';
import { createDatabase } from '@textanity/database';
import { createApp } from '../src/app.js';
import { up as legacyUp } from '../../../packages/database/migrations/202611140001_create_pages.js';
import { up as schemaUp } from '../../../packages/database/migrations/202611140002_apps_views_and_translations.js';
import {
  up as versionsUp,
  down as versionsDown,
} from '../../../packages/database/migrations/202611140003_text_versions.js';

const token = 'integration-editor-key-at-least-32-characters';
test('editor persists isolated drafts, approval, history and optimistic concurrency', async (t) => {
  const db = createDatabase(process.env.DATABASE_URL);
  const app = createApp({ database: db, editorToken: token });
  const suffix = randomUUID().replaceAll('-', '');
  const headers = { authorization: `Bearer ${token}` };
  const apps = [];
  let group;
  t.after(async () => {
    await db.query('DELETE FROM pages WHERE app_id=ANY($1::uuid[])', [apps.map((a) => a.id)]);
    await db.query('DELETE FROM views WHERE app_id=ANY($1::uuid[])', [apps.map((a) => a.id)]);
    if (group) await db.query('DELETE FROM text_groups WHERE id=$1', [group.id]);
    await db.query('DELETE FROM apps WHERE id=ANY($1::uuid[])', [apps.map((a) => a.id)]);
    await app.close();
    await db.end();
  });
  const request = async (method, url, payload, expected = 200) => {
    const response = await app.inject({
      method,
      url: '/api/editor' + url,
      headers,
      ...(payload ? { payload } : {}),
    });
    assert.equal(response.statusCode, expected, `${method} ${url}: ${response.body}`);
    return response.json();
  };
  for (const prefix of ['shop', 'other', 'unlinked'])
    apps.push(
      await request('POST', '/apps', { slug: `${prefix}-${suffix}`, name: prefix, defaultLocale: 'nb' }, 201),
    );
  const [shop, other, unlinked] = apps;
  group = await request('POST', '/groups', { key: `group_${suffix}`, name: 'Shared group' }, 201);
  for (const target of [shop, other])
    await request('POST', `/apps/${target.slug}/groups`, { groupId: group.id });
  const text = await request('POST', '/keys', { group: group.key, key: 'title' }, 201);
  const another = await request('POST', '/keys', { group: group.key, key: 'other' }, 201);
  await db.query(
    "INSERT INTO text_translations (text_id,locale,message) VALUES ($1,'nb','Basistekst'),($1,'en','Base text'),($2,'nb','Hei {name}')",
    [text.id, another.id],
  );
  await db.query(
    "INSERT INTO app_text_overrides (app_id,text_id,locale,message) VALUES ($1,$2,'nb','Egen tekst')",
    [other.id, text.id],
  );
  const matrix = (status, target = shop) =>
    request('GET', `/texts?status=${status}${target ? `&app=${target.slug}` : ''}&locales=nb,nn,en-GB`);
  const cell = (data, id = text.id, locale = 'nb') => data.rows.find((row) => row.id === id).cells[locale];
  const change = (data, message, id = text.id, locale = 'nb') => ({
    textId: id,
    locale,
    message,
    revision: cell(data, id, locale).revision,
    approvedRevision: cell(data, id, locale).approvedRevision,
  });
  const save = async (status, message, target = shop, id = text.id, locale = 'nb') => {
    const data = await matrix(status, target);
    return request('POST', '/texts/batch', {
      app: target?.slug || null,
      status,
      changes: [change(data, message, id, locale)],
    });
  };
  const approve = async (status, target = shop, id = text.id, locale = 'nb', expected = 200) => {
    const data = await matrix(status, target);
    const { message: _message, ...item } = change(data, null, id, locale);
    return request(
      'POST',
      '/texts/approve',
      { app: target?.slug || null, status, changes: [item] },
      expected,
    );
  };
  assert.equal(cell(await matrix('approved')).message, 'Basistekst');
  assert.equal(cell(await matrix('approved'), text.id, 'en-GB').message, 'Base text');
  for (const [status, value] of [
    ['development', 'Utvikling'],
    ['subject', 'Fag'],
    ['translation', 'Oversettelse'],
  ])
    await save(status, value);
  for (const [status, value] of [
    ['development', 'Utvikling'],
    ['subject', 'Fag'],
    ['translation', 'Oversettelse'],
  ]) {
    const data = await matrix(status);
    assert.equal(cell(data).message, value);
    assert.equal(cell(data).sourceStatus, status);
    assert.equal(cell(data, text.id, 'en-GB').sourceStatus, 'approved');
  }
  assert.equal(cell(await matrix('development', other)).message, 'Egen tekst');
  assert.equal(cell(await matrix('development', null)).message, 'Basistekst');
  assert.equal((await matrix('development', unlinked)).rows.length, 0);
  await save('development', '');
  assert.equal(cell(await matrix('development')).message, '');
  assert.equal(cell(await matrix('approved')).message, 'Basistekst');
  await save('development', null);
  assert.equal(cell(await matrix('development')).sourceStatus, 'approved');
  await save('development', 'Basistekst');
  assert.equal(cell(await matrix('development')).revision, null);

  // Public endpoints cannot expose drafts, including through an extra query parameter.
  assert.equal(
    (await app.inject(`/api/apps/${shop.slug}/texts/${group.key}?locale=nb`)).json().texts.title.message,
    'Basistekst',
  );
  assert.equal(
    (await app.inject(`/api/apps/${shop.slug}/texts/${group.key}?status=subject`)).statusCode,
    400,
  );
  await approve('subject');
  assert.equal(cell(await matrix('approved')).message, 'Fag');
  assert.equal(cell(await matrix('translation')).message, 'Oversettelse');
  assert.equal(cell(await matrix('subject')).sourceStatus, 'approved');
  assert.equal(cell(await matrix('approved', null)).message, 'Basistekst');

  // The same snapshot cannot be saved twice, even by simultaneous requests.
  const snapshot = await matrix('development');
  const body = { app: shop.slug, status: 'development', changes: [change(snapshot, 'Samtidig')] };
  const concurrent = await Promise.all([
    app.inject({ method: 'POST', url: '/api/editor/texts/batch', headers, payload: body }),
    app.inject({ method: 'POST', url: '/api/editor/texts/batch', headers, payload: body }),
  ]);
  assert.deepEqual(concurrent.map((r) => r.statusCode).sort(), [200, 409]);
  await approve('development');
  assert.equal(cell(await matrix('translation')).stale, true);
  await approve('translation', shop, text.id, 'nb', 409);
  await save('translation', 'Oversettelse');
  await approve('translation');

  // Invalid messages and contracts roll back the entire batch, not only the invalid cell.
  const before = await matrix('development');
  await request(
    'POST',
    '/texts/batch',
    {
      app: shop.slug,
      status: 'development',
      changes: [change(before, 'Must roll back'), change(before, 'Hello {different}', another.id)],
    },
    400,
  );
  assert.equal(cell(await matrix('development')).sourceStatus, 'approved');
  await request(
    'POST',
    '/texts/batch',
    { app: shop.slug, status: 'development', changes: [change(before, '{count, plural, one {bad}}')] },
    400,
  );
  await request(
    'POST',
    '/texts/batch',
    { app: unlinked.slug, status: 'development', changes: [change(before, 'Wrong scope')] },
    404,
  );
  await request(
    'POST',
    '/texts/batch',
    { app: shop.slug, status: 'development', changes: [change(before, 'A'), change(before, 'B')] },
    400,
  );
  await save('development', '<script>literal text</script>');
  assert.equal(cell(await matrix('development')).message, '<script>literal text</script>');
  const newKey = await request('POST', '/keys', { group: group.key, key: 'new_message' }, 201);
  await save('development', 'Hei {name}', shop, newKey.id);
  const newMatrix = await matrix('development');
  await request(
    'POST',
    '/texts/batch',
    {
      app: shop.slug,
      status: 'development',
      changes: [change(newMatrix, 'Hello {other}', newKey.id, 'en-GB')],
    },
    400,
  );

  // Creating page/view structures never crosses app boundaries; view texts are filtered.
  const page = await request(
    'POST',
    `/apps/${shop.slug}/pages`,
    { title: 'Forside', path: '/', status: 'draft' },
    201,
  );
  const view = await request('POST', `/apps/${shop.slug}/views`, { name: 'Hero', type: 'hero' }, 201);
  const foreign = await request('POST', `/apps/${other.slug}/views`, { name: 'Foreign', type: 'hero' }, 201);
  await request('POST', `/apps/${shop.slug}/pages/${page.id}/views`, { viewId: foreign.id }, 404);
  const placement = await request(
    'POST',
    `/apps/${shop.slug}/pages/${page.id}/views`,
    { viewId: view.id },
    201,
  );
  await db.query('INSERT INTO page_views (app_id,page_id,view_id,position,config) VALUES ($1,$2,$3,1,$4)', [
    shop.id,
    page.id,
    view.id,
    JSON.stringify({ title: `${group.key}.other` }),
  ]);
  await request('PUT', `/apps/${shop.slug}/views/${view.id}/texts`, { textIds: [text.id] });
  const filtered = await request(
    'GET',
    `/texts?app=${shop.slug}&view=${view.id}&page=${page.id}&placement=${placement.id}&status=development`,
  );
  assert.deepEqual(
    filtered.rows.map((r) => r.id),
    [text.id],
  );
  assert.equal((await request('GET', `/apps/${shop.slug}`)).pages[0].view_count, 2);
  assert.equal((await app.inject(`/api/apps/${shop.slug}/pages?path=/`)).statusCode, 404);
  const revisions = await request('GET', `/texts/${text.id}/history?app=${shop.slug}`);
  assert(revisions.some((r) => r.action === 'reset'));
  assert(revisions.some((r) => r.action === 'approve' && r.source_status === 'subject'));
  assert(revisions.some((r) => r.message === ''));
  assert.equal((await app.inject('/api/health/ready')).statusCode, 200);
});

test('migration preserves approved translations and seeds history without enabling lossy rollback', async () => {
  const db = knex({ client: 'pg', connection: process.env.DATABASE_URL, pool: { min: 0, max: 1 } });
  const schema = `versions_${randomUUID().replaceAll('-', '')}`;
  try {
    await db.transaction(async (trx) => {
      await trx.raw('CREATE SCHEMA ??', [schema]);
      await trx.raw('SET LOCAL search_path TO ??', [schema]);
      await legacyUp(trx);
      await schemaUp(trx);
      const [group] = await trx('text_groups').insert({ key: 'home', name: 'Home' }).returning('*');
      const [text] = await trx('texts').insert({ group_id: group.id, key: 'title' }).returning('*');
      await trx('text_translations').insert({
        text_id: text.id,
        locale: 'nb',
        message: 'Existing approved text',
      });
      await versionsUp(trx);
      assert.equal((await trx('text_translations').first()).message, 'Existing approved text');
      assert.equal((await trx('text_revisions').first()).action, 'baseline');
      await versionsDown(trx);
      await versionsUp(trx);
      await trx('text_drafts').insert({
        text_id: text.id,
        locale: 'nb',
        status: 'development',
        message: 'Draft',
        approved_hash: 'a'.repeat(64),
      });
      await assert.rejects(
        trx.transaction((savepoint) => versionsDown(savepoint)),
        /Cannot roll back/,
      );
      assert.equal((await trx('text_drafts').first()).message, 'Draft');
      await trx.raw('DROP SCHEMA ?? CASCADE', [schema]);
    });
  } finally {
    await db.destroy();
  }
});
