import { describe, expect, it } from 'vitest';
import {
  buildPhase0IdentityCollisionAuditReport,
  buildStrongIdentityComponents,
  normalizePhase0IdentityValue,
} from '../phase0IdentityCollisionAuditCore';

const BASE_INPUT = {
  environment: 'development' as const,
  db: 'Development',
  sourceCommit: 'a'.repeat(40),
  documentLimit: 100,
  groupLimit: 100,
  groupMemberLimit: 10,
  maxTimeMs: 5_000,
  strict: true,
  possibleDocumentTruncation: false,
  fingerprintSalt: 'unit-test-secret-that-is-longer-than-thirty-two-characters',
  generatedAt: '2026-07-28T00:00:00.000Z',
};

describe('buildPhase0IdentityCollisionAuditReport', () => {
  it('classifies same-name-only people only when governed strong identity keys do not join them', () => {
    const report = buildPhase0IdentityCollisionAuditReport({
      ...BASE_INPUT,
      users: [
        {
          id: 'same-name-one',
          fname: 'Alex',
          lname: 'Rivera',
          netid: 'ar1001',
          email: 'alex.one@example.test',
          userConfirmed: true,
        },
        {
          id: 'same-name-two',
          fname: 'Álex',
          lname: 'Rivera',
          netid: 'ar2002',
          email: 'alex.two@example.test',
        },
        {
          id: 'joined-one',
          fname: 'Jordan',
          lname: 'Lee',
          orcid: '0000-0002-1825-0097',
        },
        {
          id: 'joined-two',
          fname: 'Jordan',
          lname: 'Lee',
          orcid: '0000-0002-1825-0097',
        },
      ],
    });

    expect(report.summary.sameNameOnlyGroups).toBe(1);
    expect(report.sameNameOnlyGroups).toHaveLength(1);
    expect(report.sameNameOnlyGroups[0]).toMatchObject({
      normalizedName: 'alex rivera',
      memberCount: 2,
    });
    expect(report.summary.identityCollisionGroupsByField.orcid).toBe(1);
    expect(report.sameNameOnlyGroups).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ normalizedName: 'jordan lee' })]),
    );
  });

  it('keeps human owner and disposition acceptance pending for every measured class', () => {
    const report = buildPhase0IdentityCollisionAuditReport({
      ...BASE_INPUT,
      users: [
        { id: 'one', fname: 'First', lname: 'Person', email: 'shared@example.test' },
        { id: 'two', fname: 'Second', lname: 'Person', email: 'shared@example.test' },
      ],
    });

    expect(report.collisionClassReview).toHaveLength(7);
    expect(report.collisionClassReview).toEqual(
      expect.arrayContaining([
        {
          collisionClass: 'shared_email',
          count: 1,
          reviewRequired: true,
          owner: null,
          disposition: null,
        },
        {
          collisionClass: 'same_name_only',
          count: 0,
          reviewRequired: true,
          owner: null,
          disposition: null,
        },
      ]),
    );
  });

  it('retains actionable private record ids while fingerprinting non-group identities', () => {
    const report = buildPhase0IdentityCollisionAuditReport({
      ...BASE_INPUT,
      users: [
        {
          id: 'private-record-one',
          fname: 'First',
          lname: 'Person',
          email: 'shared@example.test',
          netid: 'fp1001',
        },
        {
          id: 'private-record-two',
          fname: 'Second',
          lname: 'Person',
          email: 'shared@example.test',
          netid: 'sp2002',
        },
      ],
    });

    const serialized = JSON.stringify(report.identityCollisionGroups);
    expect(serialized).toContain('shared@example.test');
    expect(serialized).toContain('private-record-one');
    expect(serialized).toContain('private-record-two');
    expect(serialized).not.toContain('fp1001');
    expect(serialized).not.toContain('sp2002');
    expect(report.identityCollisionGroups[0].members[0].recordFingerprint).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it('reports mixed strong-identity components instead of clearing the whole same-name group', () => {
    const report = buildPhase0IdentityCollisionAuditReport({
      ...BASE_INPUT,
      users: [
        {
          id: 'component-one-a',
          fname: 'Alex',
          lname: 'Rivera',
          email: 'joined@example.test',
        },
        {
          id: 'component-one-b',
          fname: 'Alex',
          lname: 'Rivera',
          email: 'joined@example.test',
        },
        {
          id: 'component-two',
          fname: 'Alex',
          lname: 'Rivera',
          email: 'separate@example.test',
        },
      ],
    });

    expect(report.summary.sameNameOnlyGroups).toBe(0);
    expect(report.summary.mixedNameIdentityGroups).toBe(1);
    expect(report.mixedNameIdentityGroups[0]).toMatchObject({
      normalizedName: 'alex rivera',
      strongIdentityComponentCount: 2,
      memberCount: 3,
    });
    expect(
      new Set(
        report.mixedNameIdentityGroups[0].members.map((member) => member.strongIdentityComponent),
      ),
    ).toEqual(new Set([1, 2]));
  });

  it('keeps two separate strong-identity components under one name in mixed review', () => {
    const report = buildPhase0IdentityCollisionAuditReport({
      ...BASE_INPUT,
      users: [
        { id: 'a1', fname: 'Alex', lname: 'Rivera', netid: 'ar1001' },
        { id: 'a2', fname: 'Alex', lname: 'Rivera', netid: 'ar1001' },
        { id: 'b1', fname: 'Alex', lname: 'Rivera', netid: 'ar2002' },
        { id: 'b2', fname: 'Alex', lname: 'Rivera', netid: 'ar2002' },
      ],
    });

    expect(report.summary.mixedNameIdentityGroups).toBe(1);
    expect(report.mixedNameIdentityGroups[0].strongIdentityComponentCount).toBe(2);
  });

  it('canonicalizes governed ORCID, OpenAlex, and Google Scholar identity forms', () => {
    expect(normalizePhase0IdentityValue('orcid', 'https://orcid.org/0000-0002-1825-0097/')).toBe(
      '0000-0002-1825-0097',
    );
    expect(normalizePhase0IdentityValue('orcid', '0000-0002-1825-0097')).toBe(
      '0000-0002-1825-0097',
    );
    expect(normalizePhase0IdentityValue('orcid', 'orcid:0000-0002-1825-0097')).toBe(
      '0000-0002-1825-0097',
    );
    expect(normalizePhase0IdentityValue('openAlexId', 'https://openalex.org/A12345')).toBe(
      'a12345',
    );
    expect(normalizePhase0IdentityValue('openAlexId', 'A12345')).toBe('a12345');
    expect(normalizePhase0IdentityValue('openAlexId', 'openalex:A12345')).toBe('a12345');
    expect(
      normalizePhase0IdentityValue(
        'googleScholarId',
        'https://scholar.google.com/citations?user=AbC_123&hl=en',
      ),
    ).toBe('abc_123');
    expect(normalizePhase0IdentityValue('googleScholarId', 'scholar:AbC_123')).toBe('abc_123');

    const report = buildPhase0IdentityCollisionAuditReport({
      ...BASE_INPUT,
      users: [
        {
          id: 'orcid-url',
          fname: 'Alex',
          lname: 'Rivera',
          orcid: 'https://orcid.org/0000-0002-1825-0097',
        },
        {
          id: 'orcid-bare',
          fname: 'Alex',
          lname: 'Rivera',
          orcid: 'orcid:0000-0002-1825-0097',
        },
      ],
    });
    expect(report.summary.identityCollisionGroupsByField.orcid).toBe(1);
    expect(report.summary.sameNameOnlyGroups).toBe(0);
  });

  it('handles a long alternating strong-identity chain without recursive stack growth', () => {
    const users = Array.from({ length: 20_000 }, (_, index) => ({
      id: `chain-${String(index).padStart(5, '0')}`,
      fname: 'Alex',
      lname: 'Rivera',
      ...(index % 2 === 0
        ? {
            email: `chain-${index}@example.test`,
            ...(index > 0 ? { netid: `chain${index - 1}` } : {}),
          }
        : {
            email: `chain-${index - 1}@example.test`,
            netid: `chain${index}`,
          }),
    }));

    const components = buildStrongIdentityComponents(users);

    expect(components).toHaveLength(1);
    expect(components[0]).toHaveLength(users.length);
  });

  it('uses deterministic code-point ordering when detail bounds choose a subset', () => {
    const report = buildPhase0IdentityCollisionAuditReport({
      ...BASE_INPUT,
      groupLimit: 1,
      users: [
        { id: 'z1', fname: 'Zed', lname: 'One', email: 'z@example.test' },
        { id: 'z2', fname: 'Zed', lname: 'Two', email: 'z@example.test' },
        { id: 'accent1', fname: 'Accent', lname: 'One', email: 'ä@example.test' },
        { id: 'accent2', fname: 'Accent', lname: 'Two', email: 'ä@example.test' },
      ],
    });

    expect(report.identityCollisionGroups[0].identityValue).toBe('z@example.test');
  });

  it('reports every bound separately and marks truncated evidence as a lower bound', () => {
    const report = buildPhase0IdentityCollisionAuditReport({
      ...BASE_INPUT,
      documentLimit: 3,
      groupLimit: 1,
      groupMemberLimit: 1,
      possibleDocumentTruncation: true,
      users: [
        { id: 'one', fname: 'One', lname: 'Person', email: 'first@example.test' },
        { id: 'two', fname: 'Two', lname: 'Person', email: 'first@example.test' },
        { id: 'three', fname: 'Three', lname: 'Person', email: 'second@example.test' },
        { id: 'four', fname: 'Four', lname: 'Person', email: 'second@example.test' },
      ],
    });

    expect(report.summary.identityCollisionGroupsByField.email).toBe(2);
    expect(report.identityCollisionGroups).toHaveLength(1);
    expect(report.scan).toMatchObject({
      possibleDocumentTruncation: true,
      possibleIdentityGroupTruncation: true,
      possibleGroupMemberTruncation: true,
      countSemantics: 'bounded-lower-bound',
    });
  });
});
