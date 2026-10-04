import { describe, expect, it } from 'vitest';
import { ACTIVE_SOURCE_NAMES, LLM_AUTHORED_SOURCE_NAMES } from '../../scrapers/seedSources';
import { buildResearchEntityPublicDescriptionRepresentation } from '../../services/researchEntityPublicDescription';
import { sanitizeResearchEntityPublicDescriptionFields } from '../researchEntityDescriptionText';
import {
  isLlmAuthoredSourceName,
  withoutUnbackedLabSelfDescription,
} from '../unbackedLabSelfDescription';

const llmProvenance = {
  shortDescription: { sourceName: 'lab-microsite-description-llm' },
  fullDescription: { sourceName: 'lab-microsite-description-llm' },
};

const facultyResearch = (overrides: Record<string, unknown> = {}) => ({
  name: 'Wren Okonkwo-Vale Faculty Research',
  entityType: 'FACULTY_RESEARCH_AREA',
  kind: 'individual',
  fieldProvenance: llmProvenance,
  sourceUrls: ['https://example.edu/profile/wren-okonkwo-vale/'],
  ...overrides,
});

const recast = (text: string, overrides: Record<string, unknown> = {}, field = 'fullDescription') =>
  withoutUnbackedLabSelfDescription(text, facultyResearch(overrides), field);

describe('withoutUnbackedLabSelfDescription', () => {
  it('recasts a sentence-initial lab subject onto the person', () => {
    expect(recast('The Okonkwo-Vale Lab studies tidal sediment transport.')).toBe(
      'Wren Okonkwo-Vale studies tidal sediment transport.',
    );
  });

  it('recasts a subject that carries the given name and no article', () => {
    expect(recast('Wren Okonkwo-Vale Lab focuses on estuaries.')).toBe(
      'Wren Okonkwo-Vale focuses on estuaries.',
    );
  });

  it('recasts a possessive and a mid-sentence mention', () => {
    expect(
      recast(
        "The Okonkwo-Vale Lab's methods include field coring. Students join the Okonkwo-Vale Lab in summer.",
      ),
    ).toBe(
      "Wren Okonkwo-Vale's methods include field coring. Students join Wren Okonkwo-Vale's research in summer.",
    );
  });

  it('carries the recast onto a following generic lab subject and drops a leader appositive', () => {
    expect(
      recast(
        'The Okonkwo-Vale Lab, led by Professor Wren Okonkwo-Vale, models estuaries. The lab also maps marshes.',
      ),
    ).toBe('Wren Okonkwo-Vale models estuaries. This research also maps marshes.');
  });

  it('recasts the card as well as the body', () => {
    expect(recast('The Okonkwo-Vale Lab studies estuaries.', {}, 'shortDescription')).toBe(
      'Wren Okonkwo-Vale studies estuaries.',
    );
  });

  it("leaves another person's lab alone", () => {
    const text = 'Collaborates with the Marchetti Lab on sediment cores.';
    expect(recast(text)).toBe(text);
  });

  it('leaves a same-surname lab whose given name is not the row person', () => {
    const text = 'The Ines Okonkwo-Vale Lab studies estuaries.';
    expect(recast(text)).toBe(text);
  });

  it('recasts a surname that carries a lowercase particle as one name', () => {
    expect(
      withoutUnbackedLabSelfDescription(
        "The van Okonkwo Lab's work maps estuaries.",
        facultyResearch({ name: 'Wren van Okonkwo Faculty Research' }),
        'fullDescription',
      ),
    ).toBe("Wren van Okonkwo's work maps estuaries.");
  });

  it('leaves a hyphenated lab pair whose second half is the surname', () => {
    const text = 'The Marchetti-Vale Lab studies estuaries.';
    expect(
      withoutUnbackedLabSelfDescription(
        text,
        facultyResearch({ name: 'Wren Vale Faculty Research' }),
        'fullDescription',
      ),
    ).toBe(text);
  });

  it('leaves a mention inside quotation marks', () => {
    const text = 'Space where the \u201cOkonkwo-Vale Lab\u201d meets is shared.';
    expect(recast(text)).toBe(text);
  });

  it('leaves a generic lab mention alone when no named mention was recast', () => {
    const text = 'The lab experiments use flumes.';
    expect(recast(text)).toBe(text);
  });

  it('leaves text a non-LLM source wrote', () => {
    const text = 'The Okonkwo-Vale Lab studies estuaries.';
    expect(
      recast(text, {
        fieldProvenance: { fullDescription: { sourceName: 'ysm-faculty-directory' } },
      }),
    ).toBe(text);
  });

  it('leaves the row alone when a non-LLM description names the lab', () => {
    const text = 'The Okonkwo-Vale Lab studies estuaries.';
    expect(
      recast(text, {
        shortDescription: 'The Okonkwo-Vale Lab maps estuaries.',
        fieldProvenance: {
          fullDescription: { sourceName: 'lab-microsite-description-llm' },
          shortDescription: { sourceName: 'dept-faculty-roster' },
        },
      }),
    ).toBe(text);
  });

  it('still recasts when a cited lab URL names somebody else', () => {
    expect(
      recast('The Okonkwo-Vale Lab studies estuaries.', {
        sourceUrls: ['https://example.edu/labs/marchetti/'],
      }),
    ).toBe('Wren Okonkwo-Vale studies estuaries.');
  });

  it("leaves the row alone when a cited URL is this person's lab site", () => {
    const text = 'The Okonkwo-Vale Lab studies estuaries.';
    expect(recast(text, { websiteUrl: 'https://okonkwovalelab.example.edu/' })).toBe(text);
  });

  it('leaves a mention alone when the lab name continues past the word', () => {
    for (const text of [
      'The Okonkwo-Vale Laboratory for Coastal Geology investigates estuaries.',
      'The Okonkwo-Vale Lab members study estuaries.',
      'Students join the Okonkwo-Vale Lab group in summer.',
    ]) {
      expect(recast(text)).toBe(text);
    }
  });

  it('leaves a row typed LAB alone', () => {
    const text = 'The Okonkwo-Vale Lab studies estuaries.';
    expect(
      withoutUnbackedLabSelfDescription(
        text,
        { ...facultyResearch(), name: 'Okonkwo-Vale Lab', entityType: 'LAB', kind: 'lab' },
        'fullDescription',
      ),
    ).toBe(text);
  });

  it('is idempotent', () => {
    const once = recast('The Okonkwo-Vale Lab studies estuaries. The lab maps marshes.');
    expect(recast(once)).toBe(once);
  });
});

describe('isLlmAuthoredSourceName', () => {
  it('names exactly the seed sources whose display name says LLM', () => {
    expect(ACTIVE_SOURCE_NAMES.filter(isLlmAuthoredSourceName).sort()).toEqual(
      [...LLM_AUTHORED_SOURCE_NAMES].sort(),
    );
  });
});

describe('served description of a faculty research row', () => {
  it('recasts the lab claim left heading the body after a biography opener is stripped', () => {
    const entity: Record<string, unknown> = facultyResearch({
      fullDescription:
        'Wren Okonkwo-Vale is an associate professor of Geology. The Okonkwo-Vale Lab studies tidal sediment transport in estuaries, combining field coring with flume experiments.',
    });
    expect(sanitizeResearchEntityPublicDescriptionFields({ ...entity }).fullDescription).toBe(
      'Wren Okonkwo-Vale studies tidal sediment transport in estuaries, combining field coring with flume experiments.',
    );
    const representation = buildResearchEntityPublicDescriptionRepresentation({ entity });
    expect(representation.fullDescription).toMatch(/^Wren Okonkwo-Vale studies tidal sediment/);
    expect(representation.cardDescription).not.toBe('');
  });

  it('no longer claims an unbacked lab on the public representation', () => {
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: facultyResearch({
        shortDescription: 'The Okonkwo-Vale Lab studies tidal sediment transport in estuaries.',
        fullDescription:
          'The Okonkwo-Vale Lab studies tidal sediment transport in estuaries, combining field coring with flume experiments to model how marsh edges erode under rising seas.',
      }),
    });
    const served = `${representation.cardDescription} ${representation.fullDescription}`;
    expect(served).not.toMatch(/Okonkwo-Vale Lab/);
    expect(representation.fullDescription).toMatch(/^Wren Okonkwo-Vale studies tidal sediment/);
  });
});
