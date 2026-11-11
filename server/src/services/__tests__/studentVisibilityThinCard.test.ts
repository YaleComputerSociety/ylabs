import { describe, expect, it } from 'vitest';
import { researchEntityServesPublicDetail } from '../researchEntityPublicDescription';
import {
  computeResearchEntityStudentVisibility,
  isStudentVisibilitySignalReason,
} from '../studentVisibilityTier';

const TOPICS = ['Glaciology', 'Ice Sheet Dynamics', 'Sea Level Rise'];
const THIN_ACCURATE_BODY =
  'Studies glacier hydrology, ice sheet dynamics, and coastal sea level rise.';

const fixtureEntity = (fullDescription: string, shortDescription = '', researchAreas = TOPICS) => ({
  _id: 'thin-card-fixture',
  name: 'Robin Fixture Faculty Research',
  slug: 'robin-fixture-research',
  kind: 'individual',
  entityType: 'FACULTY_RESEARCH_AREA',
  fullDescription,
  shortDescription,
  researchAreas,
  sourceUrls: ['https://fixture.example.org/profile/robin-fixture'],
});

const visibility = (entity: Record<string, any>) =>
  computeResearchEntityStudentVisibility({
    entity,
    leadMembers: [
      { role: 'pi', userId: 'robin-fixture', user: { fname: 'Robin', lname: 'Fixture' } },
    ],
  });

describe('a card held only for thinness or for echoing its own topics (#5673)', () => {
  it('serves the row and records the thin card as a non-blocking signal', () => {
    const entity = fixtureEntity(THIN_ACCURATE_BODY);
    const result = visibility(entity);

    expect(researchEntityServesPublicDetail(entity)).toBe(true);
    expect(result.tier).toBe('student_ready');
    expect(result.reasons).toContain('thin_card_description');
    expect(isStudentVisibilitySignalReason('thin_card_description')).toBe(true);
    expect(result.reasons).not.toContain('missing_card_description');
  });

  it('serves a one-topic body whose card is too short', () => {
    const result = visibility(fixtureEntity('Studies glaciology.', '', ['Glaciology']));

    expect(result.tier).toBe('student_ready');
    expect(result.reasons).toContain('thin_card_description');
  });

  it('still holds the same row when its card also carries an accuracy flag', () => {
    const result = visibility(
      fixtureEntity(
        THIN_ACCURATE_BODY,
        'Studies ice sheet dynamics and sea level rise. Studies ice sheet dynamics and sea level rise.',
      ),
    );

    expect(result.tier).toBe('operator_review');
    expect(result.reasons).toContain('missing_card_description');
    expect(result.reasons).not.toContain('thin_card_description');
  });

  it("keeps today's tier for a row whose served page fails the description check", () => {
    const entity = fixtureEntity('Glaciology, ice sheet dynamics.', '', TOPICS.slice(0, 2));
    const result = visibility(entity);

    expect(researchEntityServesPublicDetail(entity)).toBe(false);
    expect(result.tier).toBe('operator_review');
    expect(result.reasons).toEqual(
      expect.arrayContaining(['thin_description', 'missing_card_description']),
    );
  });

  it("keeps today's tier for a row with a useful body whose topic card is withheld", () => {
    const entity = fixtureEntity(
      'Builds instruments that measure meltwater beneath moving glaciers in remote polar regions.',
      '',
      ['Oncology', 'Cardiology'],
    );
    const result = visibility(entity);

    expect(researchEntityServesPublicDetail(entity)).toBe(false);
    expect(result.tier).toBe('operator_review');
    expect(result.reasons).toContain('missing_card_description');
  });

  it('serves the line naming its own topics in place of a row with no stored body', () => {
    const result = visibility(fixtureEntity('', 'Studies Ice Sheet Dynamics and Sea Level Rise.'));

    expect(result.tier).toBe('student_ready');
    expect(result.reasons).not.toContain('thin_description');
    expect(result.reasons).not.toContain('missing_card_description');
    expect(result.reasons).not.toContain('thin_card_description');
  });
  it('keeps holding a row whose thin card is the tail of a sentence broken inside a quotation', () => {
    const entity = fixtureEntity(
      THIN_ACCURATE_BODY,
      '” Studies glaciology, ice sheet dynamics, and sea level rise.',
    );
    expect(visibility(entity).tier).not.toBe('student_ready');
    expect(visibility(entity).reasons).not.toContain('thin_card_description');
  });
});
