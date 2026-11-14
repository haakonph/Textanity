import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

function setup(t, entries) {
  const database = { async query(sql, params) {
    if (sql.includes('SELECT a.id AS app_id')) {
      const id = `${params[0]}/${params[1]}`;
      return { rows: entries[id] ? [{ app_id: id, group_id: id, default_locale: 'nb' }] : [] };
    }
    return { rows: Object.entries(entries[params[0]]).map(([key, value]) => ({ key, locale: 'nb', is_override: false, ...value })) };
  } };
  const app = createApp({ database });
  t.after(() => app.close());
  return app;
}
const format = (app, key, variables = {}) => app.inject({ method: 'POST', url: `/api/apps/b/texts/ui/${key}/format`, payload: { variables } });

test('cross-app aliases follow source overrides, nested references and ICU', async (t) => {
  const app = setup(t, {
    'b/ui': { welcome: { source_app: 'a', source_group: 'common', source_key: 'greeting' } },
    'a/common': {
      greeting: { message: 'Hei {name}! [[common.count]]', is_override: true },
      count: { message: '{count, plural, one {# melding} other {# meldinger}}' },
    },
  });
  const response = await format(app, 'welcome', { name: 'Ada', count: 2 });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { locale: 'nb', message: 'Hei Ada! 2 meldinger', isOverride: true, alias: { app: 'a', group: 'common', key: 'greeting' } });
  assert.equal((await format(app, 'welcome')).statusCode, 400);
  const group = (await app.inject('/api/apps/b/texts/ui')).json();
  assert.equal(group.texts.welcome.message, 'Hei {name}! [[common.count]]');
});

test('inserted text stays literal inside parent plurals and ICU quotes', async (t) => {
  const app = setup(t, { 'b/ui': {
    outer: { message: "{n, plural, other {# / [[ui.literal]]}} '[[ui.literal]]' {_textanity_ref}" },
    literal: { message: "'{name}' # <b>tekst</b>" },
  } });
  const response = await format(app, 'outer', { n: 2, _textanity_ref: 'bruker' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().message, "2 / {name} # <b>tekst</b> '{name} # <b>tekst</b>' bruker");
});

test('missing references, alias sources, cycles and malformed ICU are server errors', async (t) => {
  const app = setup(t, { 'b/ui': {
    cycle: { message: '[[ui.cycle]]' },
    missing: { message: '[[ui.unknown]]' },
    broken: { message: '{n, plural, one {one}}' },
    alias: { source_app: 'a', source_group: 'secret', source_key: 'missing' },
    alias_cycle: { source_app: 'b', source_group: 'ui', source_key: 'mixed' },
    mixed: { message: '[[ui.alias_cycle]]' },
  } });
  for (const key of ['cycle', 'missing', 'broken', 'alias', 'alias_cycle']) {
    const response = await format(app, key);
    assert.equal(response.statusCode, 500, key);
    assert.deepEqual(response.json(), { error: 'Internal server error' });
  }
});

test('nested reuse has bounded depth', async (t) => {
  const entries = {};
  for (let i = 0; i < 40; i++) entries[`key_${i}`] = { message: `[[ui.key_${i + 1}]]` };
  assert.equal((await format(setup(t, { 'b/ui': entries }), 'key_0')).statusCode, 500);
});


test('alias chains preserve empty translations and reject alias-only cycles', async (t) => {
  const app = setup(t, {
    'b/ui': {
      first: { source_app: 'a', source_group: 'ui', source_key: 'second' },
      cycle: { source_app: 'a', source_group: 'ui', source_key: 'cycle' },
    },
    'a/ui': {
      second: { source_app: 'c', source_group: 'ui', source_key: 'empty' },
      cycle: { source_app: 'b', source_group: 'ui', source_key: 'cycle' },
    },
    'c/ui': { empty: { message: '' } },
  });
  assert.equal((await format(app, 'first')).json().message, '');
  assert.equal((await format(app, 'cycle')).statusCode, 500);
});
