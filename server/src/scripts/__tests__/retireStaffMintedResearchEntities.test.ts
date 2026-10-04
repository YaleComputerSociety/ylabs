import { describe, it, expect } from 'vitest';
import {
  descriptionStatesResearch,
  entriesInReasonScope,
  hasForeignWebsite,
  identityProfileUrlOf,
  parseRetireStaffMintedEntitiesArgs,
  populatedWebsiteFieldsOf,
} from '../retireStaffMintedResearchEntities';

const IDENTITY = 'https://medicine.example.edu/profile/a-person/';

describe('identityProfileUrlOf', () => {
  it('reads slug provenance and nothing else', () => {
    expect(identityProfileUrlOf({ fieldProvenance: { slug: { sourceUrl: IDENTITY } } })).toBe(
      IDENTITY,
    );
    // The name-provenance fallback was removed: where it fires, the row's name is by
    // definition a value some other lane wrote.
    expect(
      identityProfileUrlOf({ fieldProvenance: { name: { sourceUrl: IDENTITY } } }),
    ).toBeUndefined();
    expect(
      identityProfileUrlOf({
        fieldProvenance: { slug: { sourceUrl: 'https://chem.example.edu/people/faculty' } },
      }),
    ).toBeUndefined();
    expect(identityProfileUrlOf({})).toBeUndefined();
  });
});

describe('hasForeignWebsite', () => {
  it('is false for a website the identity page itself supplied, which is the graft', () => {
    expect(
      hasForeignWebsite(
        {
          websiteUrl: 'https://principal-lab.example.org/',
          fieldProvenance: { websiteUrl: { sourceUrl: IDENTITY } },
        },
        IDENTITY,
      ),
    ).toBe(false);
  });

  // The floor that has to hold: one field sourced elsewhere is an identity the
  // profile did not give the row, and archival cannot be undone by re-scraping.
  it('is true when any populated website field came from somewhere else', () => {
    expect(
      hasForeignWebsite(
        {
          websiteUrl: 'https://principal-lab.example.org/',
          website: 'https://another-source.example.org/',
          fieldProvenance: {
            websiteUrl: { sourceUrl: IDENTITY },
            website: { sourceUrl: 'https://medicine.example.edu/lab/principal/' },
          },
        },
        IDENTITY,
      ),
    ).toBe(true);
  });

  it('is false for a row with no website, and true when the identity page is unknown', () => {
    expect(hasForeignWebsite({ fieldProvenance: {} }, IDENTITY)).toBe(false);
    expect(hasForeignWebsite({ websiteUrl: 'https://x.example.org/' }, undefined)).toBe(true);
  });
});

describe('populatedWebsiteFieldsOf', () => {
  it('ignores blank values and reports every populated field', () => {
    expect(
      populatedWebsiteFieldsOf({ websiteUrl: '  ', website: 'https://b.example.org/' }),
    ).toEqual(['website']);
    expect(
      populatedWebsiteFieldsOf({
        websiteUrl: 'https://a.example.org/',
        website: 'https://b.example.org/',
      }),
    ).toEqual(['websiteUrl', 'website']);
    expect(populatedWebsiteFieldsOf({})).toEqual([]);
  });
});

describe('parseRetireStaffMintedEntitiesArgs', () => {
  it('defaults to a dry run', () => {
    const args = parseRetireStaffMintedEntitiesArgs([]);
    expect(args.apply).toBe(false);
    expect(args.confirm).toBe(false);
    expect(args.maxApply).toBe(200);
  });

  it('requires the confirm flag as a separate decision from --apply', () => {
    expect(parseRetireStaffMintedEntitiesArgs(['--apply']).confirm).toBe(false);
    expect(
      parseRetireStaffMintedEntitiesArgs(['--apply', '--confirm-staff-minted-entity-retirement'])
        .confirm,
    ).toBe(true);
  });

  it('rejects an unknown argument and a non-positive --max-apply', () => {
    expect(() => parseRetireStaffMintedEntitiesArgs(['--mode=apply'])).toThrow(/Unknown argument/);
    expect(() => parseRetireStaffMintedEntitiesArgs(['--max-apply=0'])).toThrow(/positive integer/);
  });

  // An empty value must still reach the resolver, which throws: the report is the only
  // pre-apply record of which rows were touched.
  it('records that --output was supplied even when its value is empty', () => {
    const args = parseRetireStaffMintedEntitiesArgs(['--output=']);
    expect(args.outputRequested).toBe(true);
    expect(args.output).toBe('');
  });
});

describe('reason scope', () => {
  it('reads each --reason as a scope and refuses a reason the stage does not plan', () => {
    expect(parseRetireStaffMintedEntitiesArgs([]).reasons).toBeUndefined();
    expect(
      parseRetireStaffMintedEntitiesArgs(['--reason=student_title', '--reason=student_title'])
        .reasons,
    ).toEqual(['student_title']);
    expect(() => parseRetireStaffMintedEntitiesArgs(['--reason=postdoc'])).toThrow(/--reason/);
    expect(() => parseRetireStaffMintedEntitiesArgs(['--reason='])).toThrow(/--reason/);
  });

  it('archives only the planned rows whose reason is in scope', () => {
    const planned = [
      { id: 'a', reason: 'student_title' as const },
      { id: 'b', reason: 'non_hosting_trainee_title' as const },
      { id: 'c', reason: 'student_title' as const },
    ];
    expect(entriesInReasonScope(planned, ['student_title']).map((entry) => entry.id)).toEqual([
      'a',
      'c',
    ]);
    expect(entriesInReasonScope(planned, undefined)).toHaveLength(3);
    expect(entriesInReasonScope(planned, [])).toHaveLength(3);
  });
});

describe('descriptionStatesResearch', () => {
  it('reads a research statement anywhere, and a research-focus phrase on the card only', () => {
    expect(
      descriptionStatesResearch({
        shortDescription: 'Studies how fixtures shape outcomes in clinical trials.',
      }),
    ).toBe(true);
    expect(
      descriptionStatesResearch({
        shortDescription:
          'Provides advising and manages the office platform for students and alumni.',
        fullDescription: 'The office supports students and is focused on career outcomes.',
      }),
    ).toBe(false);
    expect(descriptionStatesResearch({})).toBe(false);
  });
});
