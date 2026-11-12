import { describe, expect, it } from 'vitest';
import { researcherCarriesIdentityEvidence } from '../../utils/researcherIdentity';
import {
  entityIdentityNamesPerson,
  leadSurnameKey,
  pastDetachmentsOfTheNamedPerson,
  onePersonKeyByAssignment,
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
  rosterVerified: false,
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

  it('matches an accented surname against the diacritic-stripped tokens a slug carries', () => {
    expect(leadSurnameKey('Robin Peña')).toBe('pena');
    expect(entityIdentityNamesPerson(['robin', 'pena'], 'Robin Peña')).toBe(true);
    expect(entityIdentityNamesPerson(['robin', 'pena'], 'Pradeep Peña')).toBe(false);
  });

  it('matches an accented given name against the slug form of the same name', () => {
    expect(entityIdentityNamesPerson(['jose', 'quimby'], 'José Quimby')).toBe(true);
  });

  it('names a transliteration of the same given name (#5853)', () => {
    expect(entityIdentityNamesPerson(['anastasis', 'quimby'], 'Anastasios Quimby')).toBe(true);
    expect(entityIdentityNamesPerson(['muhammad', 'quimby'], 'Mohammed Quimby')).toBe(true);
  });

  it('still does not name a same-surname person with a different given name (#5853)', () => {
    expect(entityIdentityNamesPerson(['anastasis', 'quimby'], 'Andreas Quimby')).toBe(false);
    expect(entityIdentityNamesPerson(['anastasis', 'quimby'], 'Athanasios Quimby')).toBe(false);
  });

  it('keeps unrelated accented surnames in separate clash groups', () => {
    expect(leadSurnameKey('Luis Mejía')).toBe('mejia');
    expect(leadSurnameKey('Luis Mejía')).not.toBe(leadSurnameKey('Robin Peña'));
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

  it('lets the served site decide when the identity names nobody and the site is unanimous', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({
        identityTokens: ['ysm', 'quimby'],
        leads: [
          lead({ servedSiteVerdict: 'CONFIRMED' }),
          lead({
            assignmentId: 'assignment-2',
            personId: 'person-2',
            displayName: 'Pradeep Quimby',
            servedSiteVerdict: 'NAMESAKE',
          }),
        ],
      }),
    ]);
    expect(plan.detach).toEqual([
      { assignmentId: 'assignment-2', entityId: 'entity-1', personId: 'person-2' },
    ]);
    expect(plan.refused).toEqual([]);
  });

  it('refuses a site that is not unanimous about the clash', () => {
    const cases: Array<
      [SurnameClashLeadRow['servedSiteVerdict'], SurnameClashLeadRow['servedSiteVerdict']]
    > = [
      ['CONFIRMED', 'CONFIRMED'],
      ['CONFIRMED', undefined],
      [undefined, 'NAMESAKE'],
      ['NAMESAKE', 'NAMESAKE'],
    ];
    for (const [first, second] of cases) {
      const plan = planSurnameClashLeadDetachment([
        entity({
          identityTokens: ['ysm', 'quimby'],
          leads: [
            lead({ servedSiteVerdict: first }),
            lead({
              assignmentId: 'assignment-2',
              personId: 'person-2',
              displayName: 'Pradeep Quimby',
              servedSiteVerdict: second,
            }),
          ],
        }),
      ]);
      expect(plan.detach).toEqual([]);
      expect(plan.refused.map((row) => row.reason)).toEqual(['identity-names-nobody-in-the-clash']);
    }
  });

  it('lets the identity overrule the site when the identity names someone', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({
        leads: [
          lead({ servedSiteVerdict: 'NAMESAKE' }),
          lead({
            assignmentId: 'assignment-2',
            personId: 'person-2',
            displayName: 'Pradeep Quimby',
            servedSiteVerdict: 'CONFIRMED',
          }),
        ],
      }),
    ]);
    expect(plan.detach.map((row) => row.personId)).toEqual(['person-2']);
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

  it('detaches the stranger on an accented surname rather than refusing the whole class', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({
        identityTokens: ['robin', 'pena'],
        leads: [
          lead({ displayName: 'Robin Peña' }),
          lead({
            assignmentId: 'assignment-2',
            personId: 'person-2',
            displayName: 'Pradeep Peña',
          }),
        ],
      }),
    ]);
    expect(plan.detach.map((row) => row.assignmentId)).toEqual(['assignment-2']);
  });

  it('keeps a candidate the entity own roster page listed, which a graft never has', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({
        leads: [
          lead(),
          lead({
            assignmentId: 'assignment-2',
            personId: 'person-2',
            displayName: 'David Quimby',
            rosterVerified: true,
          }),
        ],
      }),
    ]);
    expect(plan.detach).toEqual([]);
    expect(plan.refused.map((row) => row.reason)).toEqual([
      'candidate-corroborated-by-the-entity-roster',
    ]);
  });

  it('still detaches the uncorroborated candidate beside a roster-listed co-lead', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({
        leads: [
          lead(),
          lead({
            assignmentId: 'assignment-2',
            personId: 'person-2',
            displayName: 'David Quimby',
            rosterVerified: true,
          }),
          lead({ assignmentId: 'assignment-3', personId: 'person-3', displayName: 'Ada Quimby' }),
        ],
      }),
    ]);
    expect(plan.detach.map((row) => row.assignmentId)).toEqual(['assignment-3']);
    expect(plan.refused.map((row) => row.reason)).toEqual([
      'candidate-corroborated-by-the-entity-roster',
    ]);
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
      'one-person-recorded-twice': 0,
      'identity-names-nobody-in-the-clash': 0,
      'identity-names-more-than-one-of-the-clash': 0,
      'named-lead-is-an-unanchored-shell': 1,
      'candidate-corroborated-by-the-entity-roster': 0,
      'assignment-already-reviewed': 0,
    });
  });
});

describe('identity evidence for a clash member (#5941)', () => {
  it('anchors a researcher on its own netid, directory email, or ORCID (#5000, #5592)', () => {
    expect(researcherCarriesIdentityEvidence({ identifiers: { netid: 'rq1' } })).toBe(true);
    expect(
      researcherCarriesIdentityEvidence({ identifiers: { email: 'robin@example.test' } }),
    ).toBe(true);
    expect(
      researcherCarriesIdentityEvidence({ identifiers: { orcid: '9999-9000-9999-9005' } }),
    ).toBe(true);
  });

  it('no longer anchors a researcher on a title or a department alone', () => {
    const titled = { identifiers: {}, profile: { title: 'Professor' } };
    const departmental = { identifiers: {}, profile: { primaryDepartment: 'Geology' } };
    expect(researcherCarriesIdentityEvidence(titled)).toBe(false);
    expect(researcherCarriesIdentityEvidence(departmental)).toBe(false);
  });

  it('leaves a bare name unanchored', () => {
    expect(researcherCarriesIdentityEvidence({ identifiers: { netid: '  ', email: '' } })).toBe(
      false,
    );
    expect(researcherCarriesIdentityEvidence({})).toBe(false);
  });
});

describe('one person stored as two Researcher records (#5941)', () => {
  const liveRecord = lead({
    assignmentId: 'assignment-live',
    personId: 'person-live',
    displayName: 'Robin Quimby',
    identity: { netid: 'rq111', title: 'Assistant Professor', department: 'Pathology' },
  });
  const identicalNameOnly = lead({
    assignmentId: 'assignment-name-only',
    personId: 'person-name-only',
    displayName: 'Robin Quimby',
    identityAnchored: false,
    identity: { title: 'Assistant Professor', department: 'Laboratory Medicine' },
  });
  const transliteratedNameOnly = lead({
    assignmentId: 'assignment-transliterated',
    personId: 'person-transliterated',
    displayName: 'Anastasis Quimby',
    identityAnchored: false,
    identity: { title: 'Assistant Professor of Engineering' },
  });
  const transliteratedLive = lead({
    assignmentId: 'assignment-transliterated-live',
    personId: 'person-transliterated-live',
    displayName: 'Anastasios Quimby',
    identity: { netid: 'aq222', title: 'Assistant Professor of Engineering' },
  });
  const stranger = lead({
    assignmentId: 'assignment-stranger',
    personId: 'person-stranger',
    displayName: 'Pradeep Quimby',
    identity: { netid: 'pq333', title: 'Assistant Professor', department: 'Pathology' },
  });

  it('refuses a live record and an identical-name name-only duplicate as one person', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({ identityTokens: ['ysm', 'quimby'], leads: [liveRecord, identicalNameOnly] }),
    ]);
    expect(plan.detach).toEqual([]);
    expect(plan.refused).toEqual([
      { entityId: 'entity-1', reason: 'one-person-recorded-twice', assignments: 2 },
    ]);
  });

  it('does not detach the live record when the identity names only the duplicate spelling', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({
        identityTokens: ['dept', 'engineering', 'anastasis', 'quimby'],
        leads: [transliteratedNameOnly, transliteratedLive],
      }),
    ]);
    expect(plan.detach).toEqual([]);
    expect(plan.refused.map((row) => row.reason)).toEqual(['one-person-recorded-twice']);
  });

  it('reads a shared netid, email, or ORCID as one person', () => {
    for (const shared of [
      { netid: 'rq111' },
      { email: 'Robin.Quimby@example.test' },
      { orcid: '9999-9000-9999-9005' },
    ]) {
      const plan = planSurnameClashLeadDetachment([
        entity({
          leads: [
            lead({ identity: { ...shared } }),
            lead({
              assignmentId: 'assignment-2',
              personId: 'person-2',
              displayName: 'R Quimby',
              identity: Object.fromEntries(
                Object.entries(shared).map(([field, value]) => [field, value.toLowerCase()]),
              ),
            }),
          ],
        }),
      ]);
      expect(plan.detach).toEqual([]);
      expect(plan.refused.map((row) => row.reason)).toEqual(['one-person-recorded-twice']);
    }
  });

  it('reads a dedupedIntoResearcherId link as one person', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({
        leads: [
          lead({ personId: 'person-live' }),
          lead({
            assignmentId: 'assignment-2',
            personId: 'person-duplicate',
            displayName: 'Bobbie Quimby',
            identityAnchored: false,
            identity: { dedupedIntoPersonId: 'person-live' },
          }),
        ],
      }),
    ]);
    expect(plan.detach).toEqual([]);
    expect(plan.refused.map((row) => row.reason)).toEqual(['one-person-recorded-twice']);
  });

  it('still detaches two different same-surname people with different netids', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({ leads: [liveRecord, stranger] }),
      entity({
        entityId: 'entity-2',
        leads: [
          liveRecord,
          lead({
            ...stranger,
            identity: { ...stranger.identity, email: 'shared@example.test' },
          }),
          lead({
            ...liveRecord,
            assignmentId: 'assignment-live-2',
            identity: { ...liveRecord.identity, email: 'shared@example.test' },
          }),
        ],
      }),
    ]);
    expect(plan.detach).toEqual([
      { assignmentId: 'assignment-stranger', entityId: 'entity-1', personId: 'person-stranger' },
      { assignmentId: 'assignment-stranger', entityId: 'entity-2', personId: 'person-stranger' },
    ]);
    expect(plan.refused).toEqual([]);
  });

  it('keeps the duplicate beside the live record and still detaches a stranger', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({ leads: [identicalNameOnly, liveRecord, stranger] }),
    ]);
    expect(plan.detach.map((row) => row.personId)).toEqual(['person-stranger']);
    expect(plan.refused).toEqual([]);
  });

  it('does not fold a name-only record that tightly matches two different people', () => {
    const twin = lead({
      ...liveRecord,
      assignmentId: 'assignment-twin',
      personId: 'person-twin',
      identity: { ...liveRecord.identity, netid: 'rq999' },
    });
    const keys = onePersonKeyByAssignment([liveRecord, twin, identicalNameOnly]);
    expect(new Set(keys.values()).size).toBe(3);
  });

  it('does not fold a name-only record whose title and department both disagree', () => {
    const keys = onePersonKeyByAssignment([
      liveRecord,
      lead({
        ...identicalNameOnly,
        identity: { title: 'Professor', department: 'Economics' },
      }),
    ]);
    expect(new Set(keys.values()).size).toBe(2);
  });

  it('does not fold a name-only record with a different given name', () => {
    const keys = onePersonKeyByAssignment([
      liveRecord,
      lead({ ...identicalNameOnly, displayName: 'Pradeep Quimby' }),
    ]);
    expect(new Set(keys.values()).size).toBe(2);
  });

  it('lists a past detachment whose person an archived duplicate on the entity resolves to', () => {
    const past = [
      {
        assignmentId: 'assignment-resolved',
        entityId: 'entity-1',
        personId: 'person-live',
        displayName: 'Robin Quimby',
        identityTokens: ['ysm', 'quimby'],
        entityLeadDuplicateResolvesToPerson: true,
      },
      {
        assignmentId: 'assignment-stranger',
        entityId: 'entity-1',
        personId: 'person-stranger',
        displayName: 'Pradeep Quimby',
        identityTokens: ['ysm', 'quimby'],
        entityLeadDuplicateResolvesToPerson: false,
      },
    ];
    expect(pastDetachmentsOfTheNamedPerson(past).map((row) => row.assignmentId)).toEqual([
      'assignment-resolved',
    ]);
  });
});

describe('one person stored under two romanisations of a given name (#5853)', () => {
  const identityTokens = ['dept', 'electrical', 'computer', 'engineering', 'anastasis', 'quimby'];
  const slugSpelling = lead({
    assignmentId: 'assignment-slug-spelling',
    personId: 'person-slug-spelling',
    displayName: 'Anastasis Quimby',
    identityAnchored: false,
  });
  const liveRecord = lead({
    assignmentId: 'assignment-live',
    personId: 'person-live',
    displayName: 'Anastasios Quimby',
  });
  const stranger = lead({
    assignmentId: 'assignment-stranger',
    personId: 'person-stranger',
    displayName: 'Andreas Quimby',
  });

  it('refuses the pair as a merge rather than detaching the live record', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({ identityTokens, leads: [slugSpelling, liveRecord] }),
    ]);
    expect(plan.detach).toEqual([]);
    expect(plan.refused).toEqual([
      {
        entityId: 'entity-1',
        reason: 'identity-names-more-than-one-of-the-clash',
        assignments: 2,
      },
    ]);
  });

  it('still detaches a same-surname person whose given name is different', () => {
    const plan = planSurnameClashLeadDetachment([
      entity({ identityTokens, leads: [liveRecord, stranger] }),
    ]);
    expect(plan.detach).toEqual([
      { assignmentId: 'assignment-stranger', entityId: 'entity-1', personId: 'person-stranger' },
    ]);
  });

  it('plans the same thing on a second run', () => {
    const rows = [
      entity({ identityTokens, leads: [slugSpelling, liveRecord] }),
      entity({ entityId: 'entity-2', identityTokens, leads: [liveRecord, stranger] }),
    ];
    expect(planSurnameClashLeadDetachment(rows)).toEqual(planSurnameClashLeadDetachment(rows));
  });

  it('lists a past detachment of the named person and not one of a stranger', () => {
    const past = [
      {
        assignmentId: 'assignment-live',
        entityId: 'entity-1',
        personId: 'person-live',
        displayName: 'Anastasios Quimby',
        identityTokens,
      },
      {
        assignmentId: 'assignment-stranger',
        entityId: 'entity-1',
        personId: 'person-stranger',
        displayName: 'Andreas Quimby',
        identityTokens,
      },
    ];
    expect(pastDetachmentsOfTheNamedPerson(past).map((row) => row.assignmentId)).toEqual([
      'assignment-live',
    ]);
    expect(pastDetachmentsOfTheNamedPerson(pastDetachmentsOfTheNamedPerson(past))).toEqual(
      pastDetachmentsOfTheNamedPerson(past),
    );
  });
});
