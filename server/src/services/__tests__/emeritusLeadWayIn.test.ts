import { describe, expect, it } from 'vitest';
import {
  decideEmeritusWayIn,
  emeritusCurrentActivityEvidence,
  leadTitlesAreAllEmeritus,
  signalIsWithheldWayIn,
  titleHoldsOnlyEmeritusAppointments,
} from '../emeritusLeadWayIn';

const NOW = new Date('2026-10-02T12:00:00Z');

describe('titleHoldsOnlyEmeritusAppointments', () => {
  it.each([
    'Professor Emeritus',
    'Professor Emeritus of Pathology',
    'Emeritus Professor of Psychiatry',
    'Professor Emerita of New Testament Criticism',
    'Emeritus Faculty',
    'Sterling Professor Emeritus of Law',
    'Senior Lector II Emeritus in Spanish and Portuguese',
    'Professor of History, Emeritus',
    'Professor of Anthropology and Named Professor of Japanese Studies, Emeritus',
    'Named Professor of Music Theory Emeritus',
    'Professor Emeritus Astronomy (retired)',
    'Named Professor Emeritus of Sociology; Director Emeritus of the Center',
    'Dean Emeritus and Named Professor in the Practice Emeritus of Trade, Finance, and Business',
    'Professor Emeritus of Medicine; Affiliated Faculty, Institute for Global Health',
    'Professor Emeritus of Law, and Founding Director and Senior Fellow, Example Center',
    'Emeriti Professor of Chemistry',
    'Professsor Emeritus of Public Health',
    '  PROFESSOR   EMERITUS  of  physics ',
    'Professor Emer\u00ADitus of Pathology',
  ])('reads %j as emeritus', (title) => {
    expect(titleHoldsOnlyEmeritusAppointments(title)).toBe(true);
  });

  it.each([
    'Professor of Emergency Medicine',
    'Professor of Pediatrics (Emergency Medicine)',
    'Professor Emeritus and Senior Research Scientist',
    'Professor Emeritus of Pathology and Senior Research Scientist',
    'Professor Emeritus of and Senior Research Scientist in Dermatology',
    'Professor Emeritus of Orthopaedics, Senior Research Scientist',
    'Named Professor Emeritus and Research Professor of Physics',
    'Research Professor and Professor Emeritus',
    'Professor Emeritus of Law and Professorial Lecturer in Law (fall term)',
    'Professor Emeritus of Pediatrics and Clinical Professor of Nursing',
    'Named Professor Emeritus of Studies and Professor of American Studies',
    'President Emeritus and Sterling Professor of Psychology; President of the University',
    'Senior Research Scientist; Professor Emeritus',
    'Director Emeritus',
    'Emeritus',
    'Emeritus Fund Professor of Chemistry',
    'Professor of History and Director, Emeriti Association',
    'Professor of Chemistry; Chair, Emeritus Faculty Fellowship Committee',
    '',
    undefined,
    null,
    42,
  ])('does not read %j as emeritus', (title) => {
    expect(titleHoldsOnlyEmeritusAppointments(title)).toBe(false);
  });
});

describe('leadTitlesAreAllEmeritus', () => {
  it('is emeritus-led when the only lead is emeritus', () => {
    expect(leadTitlesAreAllEmeritus(['Professor Emeritus of Chemistry'])).toBe(true);
  });

  it('is emeritus-led when every co-lead is emeritus', () => {
    expect(
      leadTitlesAreAllEmeritus([
        'Professor Emeritus of Chemistry',
        'Professor of Physics, Emerita',
      ]),
    ).toBe(true);
  });

  it('is not emeritus-led when a co-lead holds an active appointment', () => {
    expect(
      leadTitlesAreAllEmeritus(['Professor Emeritus of Chemistry', 'Professor of Chemistry']),
    ).toBe(false);
  });

  it('is not emeritus-led when a co-lead title is unknown', () => {
    expect(leadTitlesAreAllEmeritus(['Professor Emeritus of Chemistry', undefined])).toBe(false);
  });

  it('is not emeritus-led with no lead', () => {
    expect(leadTitlesAreAllEmeritus([])).toBe(false);
  });
});

describe('emeritusCurrentActivityEvidence', () => {
  const activity = (entity: Record<string, unknown> = {}, currentTeamMemberCount = 0) =>
    emeritusCurrentActivityEvidence({ entity, currentTeamMemberCount, now: NOW });

  it('finds nothing on a row that carries no current evidence', () => {
    expect(activity()).toEqual([]);
  });

  it('counts a research award whose end date has not passed', () => {
    expect(
      activity({ recentGrants: [{ id: 'R01XX000001', agency: 'NIH', endDate: '2027-06-30' }] }),
    ).toEqual(['running_funding']);
  });

  it('counts an award with no NIH activity code, such as an NSF award', () => {
    expect(activity({ recentGrants: [{ id: '2400001', endDate: '2027-06-30' }] })).toEqual([
      'running_funding',
    ]);
  });

  it('does not count an award that has ended or carries no end date', () => {
    expect(
      activity({
        recentGrants: [{ id: 'R01XX000001', endDate: '2025-06-30' }, { id: 'R01XX000002' }],
      }),
    ).toEqual([]);
  });

  it.each(['R13XX000001', '1R13XX000001-01', 'U13XX000001'])(
    'does not count a running conference award %s',
    (id) => {
      expect(activity({ recentGrants: [{ id, endDate: '2027-06-30' }] })).toEqual([]);
    },
  );

  it('does not count undergraduate evidence, whose lanes were measured unreliable here', () => {
    expect(
      activity({
        currentUndergradCount: 3,
        pastUndergradAdvisees: [{ count: 2, year: 2024 }],
      }),
    ).toEqual([]);
  });

  it('counts current team members on a fresh official roster', () => {
    expect(activity({}, 1)).toEqual(['current_team']);
  });

  it('reports both arms when both hold', () => {
    expect(activity({ recentGrants: [{ id: 'R01XX000001', endDate: '2027-06-30' }] }, 2)).toEqual([
      'running_funding',
      'current_team',
    ]);
  });
});

describe('decideEmeritusWayIn', () => {
  it('withholds the way in for an emeritus-led row with no current activity', () => {
    expect(decideEmeritusWayIn(['Professor Emeritus'], () => [])).toEqual({
      emeritusLed: true,
      wayInWithheld: true,
      currentActivity: [],
    });
  });

  it('keeps the way in for an emeritus-led row with current activity', () => {
    expect(decideEmeritusWayIn(['Professor Emeritus'], () => ['running_funding'])).toEqual({
      emeritusLed: true,
      wayInWithheld: false,
      currentActivity: ['running_funding'],
    });
  });

  it('never reads activity for a row that is not emeritus-led', () => {
    let read = false;
    const decision = decideEmeritusWayIn(['Professor of Chemistry'], () => {
      read = true;
      return [];
    });
    expect(decision).toEqual({ emeritusLed: false, wayInWithheld: false, currentActivity: [] });
    expect(read).toBe(false);
  });
});

describe('signalIsWithheldWayIn', () => {
  it('withholds the join-page signal only when the way in is withheld', () => {
    const type = 'APPLICATION_FORM_EXISTS';
    expect(signalIsWithheldWayIn({ type }, { wayInWithheld: true })).toBe(true);
    expect(signalIsWithheldWayIn({ type }, { wayInWithheld: false })).toBe(false);
  });

  it('keeps evidence signals that are not a way in', () => {
    expect(signalIsWithheldWayIn({ type: 'CURRENT_UNDERGRADS' }, { wayInWithheld: true })).toBe(
      false,
    );
    expect(signalIsWithheldWayIn({ type: 'PAST_UNDERGRADS' }, { wayInWithheld: true })).toBe(false);
  });
});
