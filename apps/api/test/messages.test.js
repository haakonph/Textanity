import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalLocale, createMessageFormatter, localeFallbacks } from '../src/messages.js';

test('language tags are canonical and extensions do not affect stored translations', () => {
  assert.equal(canonicalLocale('EN-gb'), 'en-GB');
  assert.equal(canonicalLocale('en-GB-u-nu-latn'), 'en-GB');
  assert.throws(() => canonicalLocale('en_US'), RangeError);
});

test('locale fallback retains script, deduplicates, and ends at app default', () => {
  assert.deepEqual(localeFallbacks('zh-Hant-HK', 'nb-NO'), ['zh-Hant-HK', 'zh-Hant', 'zh', 'nb-NO', 'nb']);
  assert.deepEqual(localeFallbacks('en-GB', 'en'), ['en-GB', 'en']);
  assert.deepEqual(localeFallbacks(undefined, 'nb'), ['nb']);
});

test('Norwegian ICU messages support zero, singular, and plural', () => {
  const formatter = createMessageFormatter('{count, plural, =0 {Ingen meldinger} one {# melding} other {# meldinger}}', 'nb');
  for (const [count, expected] of [[0, 'Ingen meldinger'], [1, '1 melding'], [2, '2 meldinger'], [25, '25 meldinger']]) {
    assert.equal(formatter.format({ count }), expected);
  }
  for (const count of ['bad', '2', true, NaN, Infinity]) assert.throws(() => formatter.format({ count }));
});

test('CLDR handles Arabic dual, few, many, and other categories', () => {
  const formatter = createMessageFormatter('{count, plural, zero {zero} one {one} two {two} few {few} many {many} other {other}}', 'ar');
  for (const [count, expected] of [[0, 'zero'], [1, 'one'], [2, 'two'], [3, 'few'], [11, 'many'], [100, 'other']]) {
    assert.equal(formatter.format({ count }), expected);
  }
});

test('ICU validates required branches and variables and treats markup as text', () => {
  assert.throws(() => createMessageFormatter('{count, plural, one {one}}', 'en'));
  const formatter = createMessageFormatter('Hello {name}', 'en');
  assert.throws(() => formatter.format({}));
  assert.equal(formatter.format({ name: '<script>example</script>' }), 'Hello <script>example</script>');
  assert.equal(createMessageFormatter('', 'nb').format(), '');
});
