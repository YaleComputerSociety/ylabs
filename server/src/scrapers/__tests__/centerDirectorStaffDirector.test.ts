import { describe, expect, it } from 'vitest';
import { decideCenterDirector, readCenterDirectorSignals } from '../utils/centerDirectorPageRead';
import { centerStaffDirectorObservation } from '../sources/centerDirectorScraper';
import { LEAD_ROLE_CANONICAL_VALUES } from '../../models/canonicalRoleMapping';

const PAGE = 'https://research.yale.edu/cores/widget-core';
const CENTER = 'Widget Imaging Core';
const card = (name: string, title: string) =>
  `<div class="card"><h3>${name}</h3><span>${title}</span></div>`;
const decide = (html: string) =>
  decideCenterDirector([readCenterDirectorSignals(html, PAGE, CENTER)]);

describe('a staff or technical director beside the faculty director (#5296)', () => {
  it('names the faculty director and records the director beside it as staff', () => {
    const decision = decide(
      card('Quill Fenwick', 'Director') + card('Orla Brightwater', 'Faculty Director'),
    );
    expect(decision).toMatchObject({
      outcome: 'named',
      director: { name: 'Orla Brightwater' },
      staffDirectors: [{ name: 'Quill Fenwick', title: 'Director' }],
    });
  });

  it('records a technical director beside the faculty director as staff', () => {
    const decision = decide(
      card('Orla Brightwater', 'Faculty Director') + card('Pell Avonmore', 'Technical Director'),
    );
    expect(decision).toMatchObject({
      outcome: 'named',
      director: { name: 'Orla Brightwater' },
      staffDirectors: [{ name: 'Pell Avonmore', title: 'Technical Director' }],
    });
  });

  it('records no staff director when the named director is not a faculty director', () => {
    const decision = decide(
      card('Orla Brightwater', 'Director') + card('Pell Avonmore', 'Technical Director'),
    );
    expect(decision).toEqual({
      outcome: 'named',
      director: expect.objectContaining({ name: 'Orla Brightwater' }),
    });
  });

  it('maps to a role that is not a lead', () => {
    expect(LEAD_ROLE_CANONICAL_VALUES).not.toContain('STAFF');
  });

  it('still refuses two faculty directors', () => {
    expect(
      decide(
        card('Orla Brightwater', 'Faculty Director') + card('Quill Fenwick', 'Faculty Director'),
      ),
    ).toMatchObject({ outcome: 'ambiguous' });
  });

  it('emits the staff directors as one entity-level observation cited to their page', () => {
    const decision = decide(
      card('Orla Brightwater', 'Faculty Director') + card('Pell Avonmore', 'Technical Director'),
    );
    if (decision.outcome !== 'named' || !decision.staffDirectors) throw new Error('expected staff');
    expect(centerStaffDirectorObservation(decision.staffDirectors, 'widget-core')).toEqual({
      entityType: 'researchEntity',
      entityKey: 'widget-core',
      field: 'inferredStaffDirectors',
      value: [{ name: 'Pell Avonmore', title: 'Technical Director' }],
      sourceUrl: PAGE,
      confidenceOverride: 0.85,
    });
  });
});
