import { IntlMessageFormat } from 'intl-messageformat';
import { TYPE } from '@formatjs/icu-messageformat-parser';

export function canonicalLocale(locale) {
  return new Intl.Locale(locale).baseName;
}

export function localeFallbacks(requested, defaultLocale) {
  const candidates = new Set();
  for (const locale of [requested || defaultLocale, defaultLocale]) {
    const parts = canonicalLocale(locale).split('-');
    while (parts.length) {
      candidates.add(parts.join('-'));
      parts.pop();
    }
  }
  return [...candidates];
}

// Constructing the formatter validates ICU syntax, including mandatory `other`.
// Treat markup as plain text; these messages are never executable HTML.
export function createMessageFormatter(message, locale) {
  const formatter = new IntlMessageFormat(message, canonicalLocale(locale), undefined, { ignoreTag: true });
  return {
    format(variables = {}) {
      validateNumbers(formatter.getAst(), variables);
      return formatter.format(Object.assign(Object.create(null), variables));
    },
  };
}

function validateNumbers(elements, variables) {
  for (const element of elements) {
    if ([TYPE.plural, TYPE.number, TYPE.date, TYPE.time].includes(element.type)
      && Object.hasOwn(variables, element.value)
      && (typeof variables[element.value] !== 'number' || !Number.isFinite(variables[element.value]))) {
      throw new TypeError(`Expected a finite number for ${element.value}`);
    }
    for (const option of Object.values(element.options || {})) validateNumbers(option.value, variables);
  }
}
