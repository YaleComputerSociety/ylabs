import { describe, expect, it } from 'vitest';
import {
  leadEmailToken,
  quoteWithLeadEmailTokens,
  withLeadEmailTokensRedacted,
  withLeadEmailTokensResolved,
} from '../leadEmailQuoteToken';

const LEAD = 'lead.person@yale.edu';

describe('quoteWithLeadEmailTokens', () => {
  it('tokenizes only the placeholder that stood for a lead address on the page', () => {
    expect(
      quoteWithLeadEmailTokens(
        'Write to [email redacted] or [email redacted].',
        'Intro. Write to\n  Lead.Person@yale.edu or other@yale.edu. Outro.',
        [LEAD],
      ),
    ).toBe(`Write to ${leadEmailToken(LEAD)} or [email redacted].`);
  });

  it('leaves the quote unchanged when it cannot be located on the page', () => {
    const quote = 'Write to [email redacted] today.';
    expect(quoteWithLeadEmailTokens(quote, 'Write to lead.person@yale.edu soon.', [LEAD])).toBe(
      quote,
    );
  });

  it('never stores the address itself', () => {
    const quote = quoteWithLeadEmailTokens('Email [email redacted].', `Email ${LEAD}.`, [LEAD]);
    expect(quote).not.toContain('@');
  });
});

describe('lead email token resolution', () => {
  const quote = `Email ${leadEmailToken(LEAD)}.`;

  it('resolves to the served address with the same digest', () => {
    expect(withLeadEmailTokensResolved(quote, ['other@yale.edu', LEAD])).toBe(`Email ${LEAD}.`);
  });

  it('falls back to the redaction placeholder when the page serves no matching address', () => {
    expect(withLeadEmailTokensResolved(quote, ['other@yale.edu'])).toBe('Email [email redacted].');
    expect(withLeadEmailTokensRedacted(quote)).toBe('Email [email redacted].');
  });
});
