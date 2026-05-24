import { describe, expect, it } from 'vitest';
import { isMaterializableUserBioCandidate } from '../profileBioQuality';

describe('profileBioQuality', () => {
  it('rejects generic adjunct appointment text as a professor bio', () => {
    expect(
      isMaterializableUserBioCandidate(
        'Adjunct faculty typically have an academic or research appointment at another institution and contribute or collaborate with one or more Example School faculty members or programs.',
      ),
    ).toBe(false);
  });

  it('rejects homepage people roster text as a professor bio', () => {
    expect(
      isMaterializableUserBioCandidate(
        "Group Postdocs Example Fellow PhD Students Example Candidate One Example Candidate Two Undergraduates Example Assistant Alumni Postdocs Example Alum, '25 - Example Institute PhD Students Example Graduate, '23 - Example Company.",
      ),
    ).toBe(false);
  });

  it('rejects publication widget chrome copied into profile bios', () => {
    expect(
      isMaterializableUserBioCandidate(
        "Yale Co-AuthorsFrequent collaborators of Example Scholar's published research.Publications TimelineA big-picture view of Example Scholar's research output by year.",
      ),
    ).toBe(false);
  });
});
