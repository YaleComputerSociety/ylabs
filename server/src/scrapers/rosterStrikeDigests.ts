import { createHash } from 'crypto';
import { redactDirectContactInfo } from '../utils/contactRedaction';

export const normalizedRosterText = (value: unknown): string =>
  redactDirectContactInfo(
    String(value || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  ).slice(0, 300);

export const normalizedRosterLabel = (value: unknown): string =>
  normalizedRosterText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * The repository is public, so an owner's refusal of one listed name, or of one row's
 * derived roster, is stored as a namespaced SHA-256 digest rather than the name or key it
 * judges (AGENTS.md, docs/person-identifier-convention.md). Changing a namespace or the
 * normalization invalidates every stored digest in officialRosterConfigs.ts.
 */
const WITHHELD_NAME_NAMESPACE = 'ylabs-roster-withheld-name:';
const DENIED_ROSTER_KEY_NAMESPACE = 'ylabs-roster-denied-key:';

const namespacedDigest = (namespace: string, value: string): string =>
  createHash('sha256').update(`${namespace}${value}`).digest('hex');

export const withheldNameDigest = (name: unknown): string =>
  namespacedDigest(WITHHELD_NAME_NAMESPACE, normalizedRosterLabel(name));

export const deniedRosterKeyDigest = (researchEntityKey: string): string =>
  namespacedDigest(DENIED_ROSTER_KEY_NAMESPACE, researchEntityKey.trim().toLowerCase());

export const ROSTER_STRIKE_DIGEST = /^[0-9a-f]{64}$/;
