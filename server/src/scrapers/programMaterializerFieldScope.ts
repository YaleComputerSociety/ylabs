import { Fellowship } from '../models/fellowship';
import { parseOnlyFieldsList } from './userMaterializerFieldScope';

const NON_EVIDENCE_PATHS = new Set(['_id', '__v', 'createdAt', 'updatedAt']);

export function programMaterializerScopeFields(): string[] {
  return Object.keys(Fellowship.schema.paths)
    .filter((path) => !NON_EVIDENCE_PATHS.has(path))
    .sort();
}

export function parseProgramOnlyFieldsList(value: string | undefined): string[] {
  const supported = programMaterializerScopeFields();
  const known = new Set(supported);
  return parseOnlyFieldsList(value, {
    flag: '--only-program-fields',
    canonical: (field) => (known.has(field) ? field : undefined),
    supported,
  });
}
