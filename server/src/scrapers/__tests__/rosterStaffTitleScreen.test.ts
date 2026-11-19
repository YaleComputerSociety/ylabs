import { describe, expect, it } from 'vitest';
import {
  buildRosterMemberCanonicalPlan,
  rosterRoleAfterStaffTitleScreen,
} from '../entityMaterializer';
import { centerRosterReadMember, memberProfileTitle } from '../sources/centersInstitutesScraper';
import { titleStatesOnlyAStaffRole } from '../sources/yaleDirectoryScraper';

const resolvedWith = (fields: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(fields).map(([field, value]) => [
      field,
      { value, hasConflict: false, confidence: 0.8, sourceName: 'fixture', observedAt: new Date() },
    ]),
  ) as any;

describe('rosterRoleAfterStaffTitleScreen (#5746)', () => {
  it('reads a faculty-default listing as staff when a title names only a staff role', () => {
    expect(
      rosterRoleAfterStaffTitleScreen(
        'core-faculty',
        resolvedWith({ profileTitle: 'Senior Administrative Assistant' }),
      ),
    ).toBe('staff');
    expect(
      rosterRoleAfterStaffTitleScreen('affiliated', resolvedWith({ title: 'Program Coordinator' })),
    ).toBe('staff');
  });

  it('keeps the listed role when any title states a faculty or research appointment', () => {
    for (const title of [
      'Postdoctoral Associate',
      'Associate Research Scientist',
      'Research Scientist',
      'Professor of Economics',
      'Lecturer',
    ]) {
      expect(
        rosterRoleAfterStaffTitleScreen('core-faculty', resolvedWith({ profileTitle: title })),
      ).toBe('core-faculty');
    }
    expect(
      rosterRoleAfterStaffTitleScreen(
        'core-faculty',
        resolvedWith({ title: 'Program Coordinator', profileTitle: 'Associate Professor' }),
      ),
    ).toBe('core-faculty');
  });

  it('never touches a lead, student or untitled listing', () => {
    const staffTitle = resolvedWith({ profileTitle: 'Administrative Assistant' });
    for (const role of ['director', 'pi', 'postdoc', 'grad-student', 'undergrad', 'staff']) {
      expect(rosterRoleAfterStaffTitleScreen(role, staffTitle)).toBe(role);
    }
    expect(rosterRoleAfterStaffTitleScreen('core-faculty', resolvedWith({}))).toBe('core-faculty');
  });
});

describe('titleStatesOnlyAStaffRole', () => {
  it('is a staff title with no faculty appointment', () => {
    expect(titleStatesOnlyAStaffRole('Grants and Finance Manager')).toBe(true);
    expect(titleStatesOnlyAStaffRole('Postdoctoral Associate')).toBe(false);
    expect(titleStatesOnlyAStaffRole('Associate Professor; Director of Operations')).toBe(false);
  });
});

describe('memberProfileTitle (#5746)', () => {
  const page = (body: string) =>
    `<html><body><h1 class="page-title">Avery Synthetic</h1>${body}</body></html>`;

  it("reads the page subject's own title and skips the page heading", () => {
    expect(memberProfileTitle(page('<p class="profile-title">Administrative Assistant</p>'))).toBe(
      'Administrative Assistant',
    );
  });

  it('ignores a staff title in a colleague card', () => {
    expect(
      memberProfileTitle(
        page('<div class="card"><p class="card__title">Program Coordinator</p></div>'),
      ),
    ).toBe('');
  });

  it('yields a faculty appointment stated anywhere on the page, so a professor never reads as staff', () => {
    expect(
      memberProfileTitle(
        page(
          '<p class="profile-title">Administrative Assistant</p><article class="profile-grid-item"><p class="profile-grid-item__title">Professor of Medicine</p></article>',
        ),
      ),
    ).toBe('Professor of Medicine');
  });

  it('reads nothing when the page metadata names several people', () => {
    const jsonLd = `<script type="application/ld+json">${JSON.stringify([
      { '@type': 'Person', name: 'Avery Synthetic', jobTitle: 'Administrative Assistant' },
      { '@type': 'Person', name: 'Blair Synthetic', jobTitle: 'Program Coordinator' },
    ])}</script>`;
    expect(memberProfileTitle(`<html><head>${jsonLd}</head><body></body></html>`)).toBe('');
  });
});

describe('center roster read membership key (#5746)', () => {
  const profileUrl = 'https://medicine.yale.edu/profile/synthetic-member/';
  const readKey = (member: Record<string, string>) =>
    centerRosterReadMember(
      { name: 'Avery Synthetic', profileUrl, role: 'core-faculty', ...member } as any,
      [{ entityKey: 'member-key' } as any],
      [],
    )?.membershipKey;
  const edgeKey = (fields: Record<string, string>) =>
    buildRosterMemberCanonicalPlan(
      '64f000000000000000000010',
      resolvedWith({ name: 'Avery Synthetic', profileUrl, role: 'core-faculty', ...fields }),
    )?.facts.rosterProvenance?.membershipKey;

  it('lists a screened staff edge under the key the materializer writes, so retirement finds it', () => {
    const titles = { profileTitle: 'Grants and Finance Manager' };
    expect(readKey(titles)).toBe(`official-profile:${profileUrl}|staff`);
    expect(readKey(titles)).toBe(edgeKey(titles));
  });

  it('keeps the listed role in the key when a title states a faculty appointment', () => {
    const titles = { title: 'Program Coordinator', profileTitle: 'Associate Professor' };
    expect(readKey(titles)).toBe(`official-profile:${profileUrl}|core-faculty`);
    expect(readKey(titles)).toBe(edgeKey(titles));
  });
});
