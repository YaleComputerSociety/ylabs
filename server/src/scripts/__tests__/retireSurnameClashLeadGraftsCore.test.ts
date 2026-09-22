import { describe, expect, it } from 'vitest';
import {
  entityIdentityNamesPerson,
  leadSurnameKey,
  planSurnameClashLeadDetachment,
  summarizeSurnameClashRefusals,
  type SurnameClashEntityRow,
  type SurnameClashLeadRow,
} from '../retireSurnameClashLeadGraftsCore';

const lead = (over: Partial<SurnameClashLeadRow> = {}): SurnameClashLeadRow => ({
  assignmentId: 'assignment-1',
  personId: 'person-1',
  displayName: 'Robin Quimby',
  reviewStatus: 'UNREVIEWED',
  identityAnchored: true,
  ...over,
});

const entity = (over: Partial<SurnameClashEntityRow> = {}): SurnameClashEntityRow => ({
  entityId: 'entity-1',
  identityTokens: ['robin', 'quimby'],
  leads: [],
  ...over,
});

describe('entityIdentityNamesPerson', () => {
  it('names a person the identity carries as a given name and a surname', () => {
    expect(entityIdentityNamesPerson(['ysm', 'robin', 'quimby'], 'Robin Quimby')).toBe(true);
  });

  it('names a middle-name form of the same person, which is a merge rather than a graft', () => {
    expect(entityIdentityNamesPerson(['robin', 'quimby'], 'Jung Yun Robin Quimby')).toBe(true);
  });

  it('names a short form of the same given name', () => {
    expect(entityIdentityNamesPerson(['ted', 'quimby'], 'Theodore Quimby')).toBe(true);
  });

  it('does not name a same-surname stranger', () => {
    expect(entityIdentityNamesPerson(['robin', 'quimby'], 'Pradeep Quimby')).toBe(false);
  });

  it('names nobody from a bare surname identity, which is what a Surname Lab carries', () => {
    expect(entityIdentityNamesPerson(['ysm', 'quimby'], 'Robin Quimby')).toBe(false);
  });

  it('does not let a surname token substring stand in for the surname', () => {
    expect(entityIdentityNamesPerson(['robin', 'quimbyson'], 'Robin Quimby')).toBe(false);
  });

  it('matches an apostrophe surname, which Yale slugs elide', () => {
    expect(entityIdentityNamesPerson(['robin', 'oquimby'], "Robin O'Quimby")).toBe(true);
    expect(leadSurnameKey("Robin O'Quimby")).toBe('oquimby');
  });
});

describe('planSurnameClashLeadDetachment', () => {
  it('detaches the same-surname lead the entity identity does not name', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({
        leads: [
          lead(),
          lead({
            assignmentId: 'assignment-2',
            personId: 'person-2',
            displayName: 'Pradeep Quimby',
          }),
        ],
      }),
    ]);
    expect(plan.detach.map((row) => row.assignmentId)).toEqual(['assignment-2']);
  });

  it('never ranks by confidence or provenance: the identity decides, so the kept lead survives', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({
        leads: [
          lead({
            assignmentId: 'assignment-2',
            personId: 'person-2',
            displayName: 'Pradeep Quimby',
          }),
          lead(),
        ],
      }),
    ]);
    expect(plan.detach.map((row) => row.personId)).toEqual(['person-2']);
  });

  it('refuses when the identity names two of the clashing people, which is a merge', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({
        leads: [
          lead(),
          lead({
            assignmentId: 'assignment-2',
            personId: 'person-2',
            displayName: 'Jung Yun Robin Quimby',
          }),
        ],
      }),
    ]);
    expect(plan.detach).toEqual([]);
    expect(plan.refused.map((row) => row.reason)).toEqual([
      'identity-names-more-than-one-of-the-clash',
    ]);
  });

  it('refuses when the identity names nobody in the clash', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({
        identityTokens: ['ysm', 'quimby'],
        leads: [
          lead(),
          lead({
            assignmentId: 'assignment-2',
            personId: 'person-2',
            displayName: 'Pradeep Quimby',
          }),
        ],
      }),
    ]);
    expect(plan.detach).toEqual([]);
    expect(plan.refused.map((row) => row.reason)).toEqual(['identity-names-nobody-in-the-clash']);
  });

  it('refuses to let a bare-name survivor evict a netid-backed record', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({
        leads: [
          lead({ identityAnchored: false }),
          lead({
            assignmentId: 'assignment-2',
            personId: 'person-2',
            displayName: 'Pradeep Quimby',
            identityAnchored: true,
          }),
        ],
      }),
    ]);
    expect(plan.detach).toEqual([]);
    expect(plan.refused.map((row) => row.reason)).toEqual(['named-lead-is-an-unanchored-shell']);
  });

  it('still detaches when neither record carries an identity anchor', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({
        leads: [
          lead({ identityAnchored: false }),
          lead({
            assignmentId: 'assignment-2',
            personId: 'person-2',
            displayName: 'Pradeep Quimby',
            identityAnchored: false,
          }),
        ],
      }),
    ]);
    expect(plan.detach.map((row) => row.assignmentId)).toEqual(['assignment-2']);
  });

  it('leaves an assignment a human already adjudicated alone', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({
        leads: [
          lead(),
          lead({
            assignmentId: 'assignment-2',
            personId: 'person-2',
            displayName: 'Pradeep Quimby',
            reviewStatus: 'APPROVED',
          }),
        ],
      }),
    ]);
    expect(plan.detach).toEqual([]);
    expect(plan.refused.map((row) => row.reason)).toEqual(['assignment-already-reviewed']);
  });

  it('leaves a lead whose surname does not clash alone, whatever the identity says', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({
        leads: [
          lead(),
          lead({
            assignmentId: 'assignment-2',
            personId: 'person-2',
            displayName: 'Pradeep Vasquez',
          }),
        ],
      }),
    ]);
    expect(plan.detach).toEqual([]);
    expect(plan.refused.map((row) => row.reason)).toEqual(['no-surname-clash']);
  });

  it('treats two roles held by one person as one lead rather than a clash', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({
        leads: [lead(), lead({ assignmentId: 'assignment-2' })],
      }),
    ]);
    expect(plan.detach).toEqual([]);
    expect(plan.refused.map((row) => row.reason)).toEqual(['no-surname-clash']);
  });

  it('always keeps the lead the entity is named after', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({
        leads: [
          lead(),
          lead({
            assignmentId: 'assignment-2',
            personId: 'person-2',
            displayName: 'Pradeep Quimby',
          }),
          lead({ assignmentId: 'assignment-3', personId: 'person-3', displayName: 'Ada Quimby' }),
        ],
      }),
    ]);
    expect(plan.detach.map((row) => row.assignmentId)).toEqual(['assignment-2', 'assignment-3']);
    expect(plan.detach.some((row) => row.personId === 'person-1')).toBe(false);
  });

  it('counts every refusal reason', () => {
    expect(
      summarizeSurnameClashRefusals([
        { entityId: 'entity-1', reason: 'no-surname-clash', assignments: 0 },
        { entityId: 'entity-2', reason: 'named-lead-is-an-unanchored-shell', assignments: 1 },
      ]),
    ).toEqual({
      'no-surname-clash': 1,
      'identity-names-nobody-in-the-clash': 0,
      'identity-names-more-than-one-of-the-clash': 0,
      'named-lead-is-an-unanchored-shell': 1,
      'assignment-already-reviewed': 0,
    });
  });
});
