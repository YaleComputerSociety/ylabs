import { describe, expect, it } from 'vitest';
import {
  normalizeGraftToken,
  planAreaGraftRemoval,
  planDescriptionGraftRemoval,
} from '../piDedupeAreaGraftPurgeCore';
import { parseArgs } from '../purgePiDedupeAreaGrafts';

const CHEN_OPTICS_FULL =
  'The Pei-Yu Chen Lab focuses on research in semiconductor lasers and optical devices, as well as photonic and optical devices. Additionally, the lab explores conducting polymers and their various applications.';
const CHEN_OPTICS_SHORT =
  'The Pei-Yu Chen Lab investigates semiconductor lasers, optical devices, and conducting polymers.';

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

describe('planDescriptionGraftRemoval', () => {
  it('clears both fields when the stored text still exactly matches the graft', () => {
    const result = planDescriptionGraftRemoval({
      currentFull: CHEN_OPTICS_FULL,
      currentShort: CHEN_OPTICS_SHORT,
      removeFull: CHEN_OPTICS_FULL,
      removeShort: CHEN_OPTICS_SHORT,
    });
    expect(result).toEqual({ clearFull: true, clearShort: true, changed: true });
  });

  it('matches case- and whitespace-insensitively', () => {
    const result = planDescriptionGraftRemoval({
      currentFull: `  ${CHEN_OPTICS_FULL.toUpperCase()}  `,
      removeFull: CHEN_OPTICS_FULL,
    });
    expect(result.clearFull).toBe(true);
    expect(result.changed).toBe(true);
  });

  it('is a no-op when the record has since self-corrected (fail closed)', () => {
    const result = planDescriptionGraftRemoval({
      currentFull:
        'The Pei-Yu Chen Lab studies cardiovascular medicine and heart-failure mechanisms.',
      currentShort: 'Cardiovascular medicine lab.',
      removeFull: CHEN_OPTICS_FULL,
      removeShort: CHEN_OPTICS_SHORT,
    });
    expect(result).toEqual({ clearFull: false, clearShort: false, changed: false });
  });

  it('clears only the field whose text matches when the other has drifted', () => {
    const result = planDescriptionGraftRemoval({
      currentFull: CHEN_OPTICS_FULL,
      currentShort: 'A corrected short description.',
      removeFull: CHEN_OPTICS_FULL,
      removeShort: CHEN_OPTICS_SHORT,
    });
    expect(result).toEqual({ clearFull: true, clearShort: false, changed: true });
  });

  it('never clears when no target string is supplied', () => {
    const result = planDescriptionGraftRemoval({
      currentFull: CHEN_OPTICS_FULL,
      currentShort: CHEN_OPTICS_SHORT,
    });
    expect(result).toEqual({ clearFull: false, clearShort: false, changed: false });
  });

  it('does not treat an empty stored field as a match for an empty target', () => {
    const result = planDescriptionGraftRemoval({
      currentFull: '',
      removeFull: '   ',
    });
    expect(result.clearFull).toBe(false);
    expect(result.changed).toBe(false);
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
