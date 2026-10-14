import { describe, expect, it } from 'vitest';
import { quoteWithPageEmailsRestored } from '../quotedEmailRestoration';

describe('quoteWithPageEmailsRestored', () => {
  it('puts back each address the placeholder stood for on the page', () => {
    expect(
      quoteWithPageEmailsRestored(
        'Write to [email redacted] or [email redacted], or call [phone redacted].',
        'Intro. Write to\n  lead.person@example.edu or other@example.edu, or call 555-010-0000. Outro.',
      ),
    ).toBe('Write to lead.person@example.edu or other@example.edu, or call [phone redacted].');
  });

  it('leaves the quote unchanged when it cannot be located on the page', () => {
    const quote = 'Write to [email redacted] today.';
    expect(quoteWithPageEmailsRestored(quote, 'Write to lead.person@example.edu soon.')).toBe(
      quote,
    );
  });
});
