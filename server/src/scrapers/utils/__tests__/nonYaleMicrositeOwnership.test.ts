import { describe, expect, it } from 'vitest';
import {
  leadSurname,
  nonYaleMicrositeOwnership,
  textNamesLead,
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

  it('refuses an address that only contains the lead surname inside a common word', () => {
    expect(
      nonYaleMicrositeOwnership({
        sourceUrl: 'https://example.org/funding',
        text: 'Apply for research funding through the trust.',
        lead: { names: ['Quillon Ding'] },
      }),
    ).toEqual({ decision: 'refuse', reason: 'lead_not_confirmed' });
  });

  it('refuses text that carries the lead surname only as an ordinary word', () => {
    expect(
      nonYaleMicrositeOwnership({
        sourceUrl: 'https://coastal-foundation.example.org/about',
        text: 'The trust has a long history of funding coastal work.',
        lead: { names: ['Quillon Long'] },
      }),
    ).toEqual({ decision: 'refuse', reason: 'lead_not_confirmed' });
  });
});

describe('ownership name helpers', () => {
  it('reads the surname from a display name, folding diacritics and apostrophes', () => {
    expect(leadSurname('Dr. Quillon Varnadore')).toBe('varnadore');
    expect(leadSurname("Ines O'Tarrow")).toBe('otarrow');
    expect(leadSurname('Zoë Brénnick')).toBe('brennick');
  });

  it('matches a surname in an address only as a whole token or joined to a research-unit word', () => {
    expect(urlCarriesSurname('https://example.org/people/vey', 'vey')).toBe(true);
    expect(urlCarriesSurname('https://example.org/varnadore-lab', 'varnadore')).toBe(true);
    expect(urlCarriesSurname('https://groupvarnadore.example.org/', 'varnadore')).toBe(true);
    expect(urlCarriesSurname('https://surveyors.example.org/', 'vey')).toBe(false);
    expect(urlCarriesSurname('https://example.org/building', 'ding')).toBe(false);
    expect(urlCarriesSurname('https://stanford.example.edu/', 'ford')).toBe(false);
  });

  it('matches the lead in text only when the given name or its initial sits beside the surname', () => {
    expect(textNamesLead('Led by Q. VARNADÖRE.', 'Quillon Varnadore')).toBe(true);
    expect(textNamesLead('Quillon R. Varnadore directs the group.', 'Dr. Quillon Varnadore')).toBe(
      true,
    );
    expect(textNamesLead('Contact: Varnadore, Quillon.', 'Quillon Varnadore')).toBe(true);
    expect(textNamesLead('Varnadore studies sediment.', 'Quillon Varnadore')).toBe(false);
    expect(textNamesLead('No mention here.', 'Quillon Varnadore')).toBe(false);
  });
});
