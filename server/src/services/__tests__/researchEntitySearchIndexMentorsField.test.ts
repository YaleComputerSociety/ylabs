import { describe, expect, it, vi } from 'vitest';

vi.mock('../undergradListEvidenceServing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../undergradListEvidenceServing')>()),
  entityMentorsUndergraduates: (row: { slug?: string }) => row.slug === 'mentor-lab',
}));

const { buildResearchEntitySearchIndexDocument, getResearchEntitySearchIndexSettings } =
  await import('../researchEntitySearchIndexService');

describe('mentors-undergrads index field', () => {
  const row = (slug: string) =>
    buildResearchEntitySearchIndexDocument({
      _id: `entity-${slug}`,
      slug,
      name: 'Synthetic Lab',
      archived: false,
      websiteUrl: 'https://synthetic.example.edu/',
    });

  it('is present only on a row the served mentors predicate accepts, and counts toward works-with', () => {
    expect(row('mentor-lab')).toMatchObject({
      mentorsUndergrads: true,
      worksWithUndergrads: true,
      hasUndergradHostingEvidence: false,
      welcomesUndergrads: false,
    });
    expect(row('other-lab')).not.toHaveProperty('mentorsUndergrads');
    expect(row('other-lab')).not.toHaveProperty('worksWithUndergrads');
  });

  it('is filterable together with works-with-undergrads in one settings change', () => {
    expect(getResearchEntitySearchIndexSettings().filterableAttributes).toEqual(
      expect.arrayContaining(['mentorsUndergrads', 'worksWithUndergrads']),
    );
  });
});
