import { describe, expect, it } from 'vitest';

import { planProfileResearchTermCleanup } from '../cleanProfileResearchTermsCore';

describe('cleanProfileResearchTermsCore', () => {
  it('plans canonical research-term repairs for stored profile arrays', () => {
    const result = planProfileResearchTermCleanup([
      {
        _id: 'user-test-alpha',
        netid: 'tst101',
        fname: 'Avery',
        lname: 'Example',
        researchInterests: [
          'Research Areas: My research interests include the synthetic moss robotics and speculative crystal mapping. I have studied fictional prototypes for classroom-only demo systems',
        ],
        topics: [
          'Research Areas: My research interests include the synthetic moss robotics and speculative crystal mapping. I have studied fictional prototypes for classroom-only demo systems',
        ],
      },
      {
        _id: 'user-test-beta',
        netid: 'tst202',
        fname: 'Jordan',
        lname: 'Sample',
        researchInterests: [
          'Lantern isotope modeling',
          'Puzzle reef acoustics',
          'Teaching Interests: My main teaching interests lie in Synthetic Field Methods',
          'Imaginary Systems (FICT 441)',
        ],
        topics: [
          'Made-up Observatory Research',
          'Invented Seminar (FAKE 342)',
        ],
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      userId: 'user-test-alpha',
      netid: 'tst101',
      name: 'Avery Example',
      nextResearchInterests: ['synthetic moss robotics', 'speculative crystal mapping'],
      nextTopics: ['synthetic moss robotics', 'speculative crystal mapping'],
      researchInterestsChanged: true,
      topicsChanged: true,
    });
    expect(result[1]).toMatchObject({
      userId: 'user-test-beta',
      netid: 'tst202',
      name: 'Jordan Sample',
      nextResearchInterests: ['Lantern isotope modeling', 'Puzzle reef acoustics'],
      nextTopics: ['Made-up Observatory Research'],
      researchInterestsChanged: true,
      topicsChanged: true,
    });
  });
});
