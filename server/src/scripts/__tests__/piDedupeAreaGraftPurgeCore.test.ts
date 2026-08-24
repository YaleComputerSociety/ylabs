import { describe, expect, it } from 'vitest';
import { normalizeGraftToken, planAreaGraftRemoval } from '../piDedupeAreaGraftPurgeCore';
import { parseArgs } from '../purgePiDedupeAreaGrafts';

describe('planAreaGraftRemoval', () => {
  it('removes the verified graft strings and preserves the real discipline area', () => {
    const result = planAreaGraftRemoval({
      current: [
        'Semiconductor Lasers and Optical Devices',
        'Photonic and Optical Devices',
        'Conducting polymers and applications',
        'Thermal Radiation and Cooling Technologies',
        'Semiconductor Quantum Structures and Devices',
        'Internal Medicine',
      ],
      removeAreas: [
        'Semiconductor Lasers and Optical Devices',
        'Photonic and Optical Devices',
        'Conducting polymers and applications',
        'Thermal Radiation and Cooling Technologies',
        'Semiconductor Quantum Structures and Devices',
      ],
    });
    expect(result.changed).toBe(true);
    expect(result.cleaned).toEqual(['Internal Medicine']);
    expect(result.removed).toHaveLength(5);
  });

  it('matches case- and whitespace-insensitively', () => {
    const result = planAreaGraftRemoval({
      current: ['  Vehicle   Emissions and Performance ', 'Bioethics'],
      removeAreas: ['vehicle emissions and performance'],
    });
    expect(result.changed).toBe(true);
    expect(result.cleaned).toEqual(['Bioethics']);
  });

  it('is a no-op when no graft string is present (fail closed)', () => {
    const result = planAreaGraftRemoval({
      current: ['Economics', 'Game Theory'],
      removeAreas: ['Educational Technology'],
    });
    expect(result.changed).toBe(false);
    expect(result.cleaned).toEqual(['Economics', 'Game Theory']);
    expect(result.removed).toEqual([]);
  });

  it('never removes a legitimate area that is not on the graft list', () => {
    const result = planAreaGraftRemoval({
      current: ['Optical imaging of microfluidic-scale biological fluid flow', 'Medical Imaging'],
      removeAreas: ['Quantum optics and atomic interactions'],
    });
    expect(result.cleaned).toEqual([
      'Optical imaging of microfluidic-scale biological fluid flow',
      'Medical Imaging',
    ]);
    expect(result.changed).toBe(false);
  });

  it('can empty an all-grafted area list', () => {
    const result = planAreaGraftRemoval({
      current: ['Educational Technology', 'Research Methods'],
      removeAreas: ['Educational Technology', 'Research Methods'],
    });
    expect(result.cleaned).toEqual([]);
    expect(result.changed).toBe(true);
  });
});

describe('normalizeGraftToken', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeGraftToken('  Research   Methods ')).toBe('research methods');
  });
});

describe('parseArgs', () => {
  it('defaults to a guarded dry-run', () => {
    const options = parseArgs([]);
    expect(options.apply).toBe(false);
    expect(options.confirm).toBe(false);
  });

  it('requires the confirm flag when applying', () => {
    expect(() => parseArgs(['--apply'])).toThrow(/--confirm-pi-dedupe-area-graft-purge/);
  });

  it('accepts apply with confirm', () => {
    const options = parseArgs(['--apply', '--confirm-pi-dedupe-area-graft-purge']);
    expect(options.apply).toBe(true);
    expect(options.confirm).toBe(true);
  });

  it('rejects unknown arguments', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
  });
});
