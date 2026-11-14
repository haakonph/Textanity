import { parse, TYPE } from '@formatjs/icu-messageformat-parser';
import { getTextGroup } from './content.js';
import { createMessageFormatter } from './messages.js';

// Request-local caches: edits and app overrides are visible on the next request.
export function createTextResolver(database, requestedLocale) {
  const groups = new Map();
  const limit = 32;
  let visits = 0;
  async function load(app, group) {
    const id = `${app}/${group}`;
    if (!groups.has(id)) groups.set(id, getTextGroup(database, app, group, requestedLocale));
    return groups.get(id);
  }
  function enter(app, group, key, path) {
    const id = `${app}/${group}.${key}`;
    if (path.includes(id)) throw new Error('Circular text reference');
    if (path.length >= limit || ++visits > 512) throw new Error('Text reference limit exceeded');
    return [...path, id];
  }
  async function resolve(app, group, key, path = []) {
    const next = enter(app, group, key, path);
    const data = await load(app, group);
    const text = data && Object.hasOwn(data.texts, key) ? data.texts[key] : null;
    if (!text) return null;
    if (text.alias) {
      const source = text.alias;
      const target = await resolve(source.app, source.group, source.key, next);
      if (!target || target.text.message === null) throw new Error('Missing alias source translation');
      return { ...target, alias: source };
    }
    return { text, app, group, key, path: next };
  }
  async function compile(resolved) {
    const { text, app, path } = resolved;
    const ast = parse(text.message, { ignoreTag: true });
    const names = new Set();
    function collect(elements) {
      for (const element of elements) {
        if (element.type !== TYPE.literal && typeof element.value === 'string') names.add(element.value);
        for (const option of Object.values(element.options || {})) collect(option.value);
      }
    }
    collect(ast);
    const children = [];
    async function expand(elements) {
      const output = [];
      for (const element of elements) {
        if (element.type === TYPE.literal) {
          let offset = 0;
          for (const match of element.value.matchAll(/\[\[([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)\]\]/g)) {
            output.push({ type: TYPE.literal, value: element.value.slice(offset, match.index) });
            let name = '_textanity_ref';
            while (names.has(name)) name += '_';
            names.add(name);
            const child = await resolve(app, match[1], match[2], path);
            if (!child || child.text.message === null) throw new Error('Missing referenced translation');
            children.push({ name, formatter: await compile(child) });
            output.push({ type: TYPE.argument, value: name });
            offset = match.index + match[0].length;
          }
          output.push({ type: TYPE.literal, value: element.value.slice(offset) });
        } else {
          if (element.options) {
            for (const option of Object.values(element.options)) option.value = await expand(option.value);
          }
          output.push(element);
        }
      }
      return output;
    }
    const formatter = createMessageFormatter(await expand(ast), text.locale);
    return {
      format(variables = {}) {
        const values = Object.assign(Object.create(null), variables);
        for (const child of children) values[child.name] = child.formatter.format(variables);
        const message = formatter.format(values);
        if (message.length > 1024 * 1024) throw new Error('Formatted message too large');
        return message;
      },
    };
  }
  return {
    async group(app, group) {
      const data = await load(app, group);
      if (!data) return null;
      const texts = {};
      for (const key of Object.keys(data.texts)) {
        visits = 0;
        const resolved = await resolve(app, group, key);
        Object.defineProperty(texts, key, { value: {
          ...resolved.text,
          ...(resolved.alias ? { alias: resolved.alias } : {}),
        }, enumerable: true });
      }
      return { ...data, texts };
    },
    async formatter(app, group, key) {
      const resolved = await resolve(app, group, key);
      if (!resolved || resolved.text.message === null) return null;
      return { ...resolved.text, formatter: await compile(resolved), ...(resolved.alias ? { alias: resolved.alias } : {}) };
    },
  };
}
