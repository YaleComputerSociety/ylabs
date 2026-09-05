import { describe, expect, it } from 'vitest';

import {
  isResearchHomeLocation,
  isResearchHomeResetState,
  researchHomeResetState,
} from '../researchHomeNavigation';

describe('researchHomeNavigation', () => {
  it('treats only the bare research home as the research home location', () => {
    expect(isResearchHomeLocation({ pathname: '/research', search: '' })).toBe(true);
    expect(isResearchHomeLocation({ pathname: '/research', search: '?q=neuroscience' })).toBe(false);
    expect(isResearchHomeLocation({ pathname: '/research/some-lab', search: '' })).toBe(false);
    expect(isResearchHomeLocation({ pathname: '/programs', search: '' })).toBe(false);
  });

  it('always asks for an in-page reset, because the URL cannot express page state', () => {
    expect(researchHomeResetState()).toEqual({ resetResearchHome: true });
    expect(isResearchHomeResetState(researchHomeResetState())).toBe(true);
  });

  it('recognizes the reset intent and rejects unrelated navigation state', () => {
    expect(isResearchHomeResetState({ resetResearchHome: true })).toBe(true);
    expect(isResearchHomeResetState({ resetResearchHome: 'yes' })).toBe(false);
    expect(isResearchHomeResetState({ from: '/research?q=neuroscience' })).toBe(false);
    expect(isResearchHomeResetState(null)).toBe(false);
    expect(isResearchHomeResetState(undefined)).toBe(false);
  });
});
