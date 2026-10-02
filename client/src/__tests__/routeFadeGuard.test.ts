import { readFileSync } from 'fs';
import { join } from 'path';

import postcss, { type AtRule } from 'postcss';
import { describe, expect, it } from 'vitest';

const STYLESHEET = join(__dirname, '..', 'index.css');

const CONTAINING_BLOCK_PROPERTIES =
  /^(?:transform|translate|scale|rotate|filter|perspective|backdrop-filter|will-change|contain)$/;

const stylesheet = () => postcss.parse(readFileSync(STYLESHEET, 'utf8'));

const animationNamesOf = (selector: string): string[] => {
  const names: string[] = [];
  stylesheet().walkRules(selector, (rule) => {
    rule.walkDecls(/^animation(-name)?$/, (declaration) => {
      names.push(...declaration.value.split(',').map((part) => part.trim().split(/\s+/)[0]));
    });
  });
  return names;
};

const keyframesNamed = (name: string): AtRule | null => {
  let found: AtRule | null = null;
  stylesheet().walkAtRules('keyframes', (rule) => {
    if (rule.params === name) found = rule;
  });
  return found;
};

describe('route fade guard', () => {
  it('fades the route wrapper without creating a containing block for fixed descendants', () => {
    const names = animationNamesOf('.yr-fade-in');
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const keyframes = keyframesNamed(name);
      expect(keyframes, `@keyframes ${name} is declared`).not.toBeNull();

      const animated: string[] = [];
      keyframes!.walkDecls((declaration) => {
        animated.push(declaration.prop);
      });
      expect(animated).toContain('opacity');
      expect(animated.filter((prop) => CONTAINING_BLOCK_PROPERTIES.test(prop))).toEqual([]);
    }
  });

  it('declares no containing-block property on the route wrapper itself', () => {
    const declared: string[] = [];
    stylesheet().walkRules('.yr-fade-in', (rule) => {
      rule.walkDecls((declaration) => {
        declared.push(declaration.prop);
      });
    });

    expect(declared.filter((prop) => CONTAINING_BLOCK_PROPERTIES.test(prop))).toEqual([]);
  });
});
