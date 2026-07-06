import { describe, expect, it } from 'vitest';
import { publicContactEmail } from '../contactEmail';

describe('publicContactEmail', () => {
  it('allows Yale-managed public contact emails', () => {
    expect(publicContactEmail('Research.Office@Yale.edu')).toBe('research.office@yale.edu');
    expect(publicContactEmail('mailto:team@medicine.yale.edu')).toBe('team@medicine.yale.edu');
  });

  it('rejects non-institutional and header-injected emails', () => {
    expect(publicContactEmail('researcher@gmail.com')).toBeUndefined();
    expect(publicContactEmail('advisor@example.edu')).toBeUndefined();
    expect(publicContactEmail('person@yale.edu?bcc=attacker@example.test')).toBeUndefined();
  });
});
