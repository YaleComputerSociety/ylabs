import { describe, expect, it } from 'vitest';
import {
  leadSurname,
  nonYaleMicrositeOwnership,
  textNamesSurname,
  urlCarriesSurname,
} from '../nonYaleMicrositeOwnership';

const lead = { names: ['Quillon Varnadore'] };

describe('nonYaleMicrositeOwnership', () => {
  it('refuses a non-Yale page that neither its address nor its text ties to the lead', () => {
    expect(
      nonYaleMicrositeOwnership({
        sourceUrl: 'https://coastal-foundation.example.org/about',
        text: 'The foundation funds coastal restoration projects across the region.',
        lead,
      }),
    ).toEqual({ decision: 'refuse', reason: 'lead_not_confirmed' });
  });

  it('admits a non-Yale page whose text names the lead', () => {
    expect(
      nonYaleMicrositeOwnership({
        sourceUrl: 'https://tidewater-collaborative.example.org/',
        text: 'Principal investigator: Quillon Varnadore. We study estuarine sediment.',
        lead,
      }),
    ).toEqual({ decision: 'admit', reason: 'text_names_lead' });
  });

  it('admits a personal-name domain even when its text never names the lead', () => {
    expect(
      nonYaleMicrositeOwnership({
        sourceUrl: 'https://qvey.example/',
        text: 'Research on estuarine sediment transport.',
        lead: { names: ['Quillon Vey'] },
      }),
    ).toEqual({ decision: 'admit', reason: 'personal_name_domain' });
  });

  it('admits a page whose address carries the lead surname', () => {
    expect(
      nonYaleMicrositeOwnership({
        sourceUrl: 'https://varnadorelab.github.io/research',
        text: 'Research on estuarine sediment transport.',
        lead,
      }),
    ).toEqual({ decision: 'admit', reason: 'surname_in_url' });
  });

  it('leaves Yale-hosted pages to the existing rules', () => {
    expect(
      nonYaleMicrositeOwnership({
        sourceUrl: 'https://medicine.yale.edu/lab/unrelated/',
        text: 'Nothing here names the lead.',
        lead,
      }),
    ).toEqual({ decision: 'not_applicable', reason: 'yale_host' });
  });

  it('does not treat a lookalike host as Yale', () => {
    expect(
      nonYaleMicrositeOwnership({
        sourceUrl: 'https://notyale.edu/about',
        text: 'Nothing here names the lead.',
        lead,
      }).decision,
    ).toBe('refuse');
  });

  it('has nothing to confirm when the row has no lead surname', () => {
    expect(
      nonYaleMicrositeOwnership({
        sourceUrl: 'https://coastal-foundation.example.org/about',
        text: 'Anything.',
        lead: { names: [undefined, ''] },
      }),
    ).toEqual({ decision: 'not_applicable', reason: 'no_lead_surname' });
  });

  it('admits when any one of several lead names is confirmed', () => {
    expect(
      nonYaleMicrositeOwnership({
        sourceUrl: 'https://tidewater-collaborative.example.org/',
        text: 'Directed by Orsolya Brennick.',
        lead: { names: ['Quillon Varnadore', 'Orsolya Brennick'] },
      }).decision,
    ).toBe('admit');
  });

  it('does not admit on a surname that only appears inside a longer word in the text', () => {
    expect(
      nonYaleMicrositeOwnership({
        sourceUrl: 'https://example.org/',
        text: 'The varnadores reunion was held downtown.',
        lead,
      }).decision,
    ).toBe('refuse');
  });

  it('gives the same verdict when asked twice', () => {
    const input = {
      sourceUrl: 'https://coastal-foundation.example.org/about',
      text: 'The foundation funds coastal restoration.',
      lead,
    };
    expect(nonYaleMicrositeOwnership(input)).toEqual(nonYaleMicrositeOwnership(input));
  });
});

describe('ownership name helpers', () => {
  it('reads the surname from a display name, folding diacritics and apostrophes', () => {
    expect(leadSurname('Dr. Quillon Varnadore')).toBe('varnadore');
    expect(leadSurname("Ines O'Tarrow")).toBe('otarrow');
    expect(leadSurname('Zoë Brénnick')).toBe('brennick');
  });

  it('matches a short surname in an address only as a whole token', () => {
    expect(urlCarriesSurname('https://example.org/people/vey', 'vey')).toBe(true);
    expect(urlCarriesSurname('https://surveyors.example.org/', 'vey')).toBe(false);
  });

  it('matches a surname in text as a whole word, case and accent folded', () => {
    expect(textNamesSurname('Led by Q. VARNADÖRE.', 'varnadore')).toBe(true);
    expect(textNamesSurname('No mention here.', 'varnadore')).toBe(false);
  });
});
