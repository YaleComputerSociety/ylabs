import { createHash } from 'node:crypto';

export const BROWSE_TIEBREAK_KEY_ATTRIBUTE = 'browseTiebreakKey';

export function researchEntityBrowseTiebreakKey(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 16);
}
