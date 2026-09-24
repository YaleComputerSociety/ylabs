import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanPublicProfileBio, isLikelySameNameContaminatedProfile } from '../profileService';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('profileService profile shaping', () => {
  it('keeps explicit nickname/alias profile URLs when the last name also matches', () => {
    const profileWithShortName = {
      netid: 'jh123',
      fname: 'Jacob',
      lname: 'North',
      bio: 'Jacob North writes essays and narrative nonfiction.',
      profileUrls: {
        english: 'https://english.yale.edu/people/full-part-time-lecturers/jake-north',
      },
      researchInterests: ['Narrative nonfiction'],
    };
    const profileWithInitialName = {
      netid: 'lj123',
      fname: 'LJ',
      lname: 'Jensen',
      bio: 'LJ Jensen teaches public-sector leadership and nonprofit governance.',
      profileUrls: {
        som: 'https://som.yale.edu/faculty-research/faculty-directory/laura-jensen',
      },
      researchInterests: ['Leadership'],
    };
    const profileWithRomanizedName = {
      netid: 'ip123',
      fname: 'Ian',
      lname: 'Park',
      bio: 'Ian Park teaches clinical practice and biomedical methods.',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/inhyun-park/',
      },
      researchInterests: ['Biomedical methods'],
    };
    const profileWithFormalName = {
      netid: 'jb123',
      fname: 'Jim',
      lname: 'Barlow',
      bio: 'Jim Barlow studies organizations, work, and labor markets.',
      profileUrls: {
        som: 'https://som.yale.edu/faculty-research/faculty-directory/james-barlow',
      },
      researchInterests: ['Organizations'],
    };

    expect(isLikelySameNameContaminatedProfile(profileWithShortName)).toBe(false);
    expect(isLikelySameNameContaminatedProfile(profileWithInitialName)).toBe(false);
    expect(isLikelySameNameContaminatedProfile(profileWithRomanizedName)).toBe(false);
    expect(isLikelySameNameContaminatedProfile(profileWithFormalName)).toBe(false);
  });

  it('strips contact chrome from otherwise useful public bios', () => {
    const inlineContactBio =
      'Xiaofeng joined Yale in 03/2024 as an Assistant Professor (forward related email to: liuxiaof@broadinstitute.org). His research interests are centered around medical imaging, machine learning, and cancer detection.';
    expect(cleanPublicProfileBio({ bio: inlineContactBio })).toBe(
      'Xiaofeng joined Yale in 03/2024 as an Assistant Professor. His research interests are centered around medical imaging, machine learning, and cancer detection.',
    );

    const leadingContactBio =
      'Riley Metabolic, Ph.D. Professor Email: riley.metabolic@yale.eduPhone: 737-1216 Dr. Riley Metabolic is a Tenure Professor in the Department of Cellular and Molecular Physiology. Her research focuses on mitochondria-endoplasmic reticulum interactions and metabolic regulation in the central nervous system.';
    expect(cleanPublicProfileBio({ bio: leadingContactBio })).toBe(
      'Dr. Riley Metabolic is a Tenure Professor in the Department of Cellular and Molecular Physiology. Her research focuses on mitochondria-endoplasmic reticulum interactions and metabolic regulation in the central nervous system.',
    );
  });

  it('strips official profile CTA and glued update chrome from narrative bios', () => {
    expect(
      cleanPublicProfileBio({
        bio: 'Nicholas Blondin treats benign and malignant brain tumors. Watch a video with Dr. Nicholas Blondin>> Dr. Blondin’s clinical expertise is in treating brain and spine metastasis.',
      }),
    ).toBe(
      'Nicholas Blondin treats benign and malignant brain tumors. Dr. Blondin’s clinical expertise is in treating brain and spine metastasis.',
    );

    expect(
      cleanPublicProfileBio({
        bio: 'Pamela Kunz is an international leader in clinical research for patients with GI malignancies. Learn more about Dr. Kunz >>',
      }),
    ).toBe(
      'Pamela Kunz is an international leader in clinical research for patients with GI malignancies.',
    );

    expect(
      cleanPublicProfileBio({
        bio: 'Stuart Seropian studies methods to improve transplantation outcomes through novel anti-cancer agents and methods of treating graft versus host diseaseLast Updated on December 01, 2024.',
      }),
    ).toBe(
      'Stuart Seropian studies methods to improve transplantation outcomes through novel anti-cancer agents and methods of treating graft versus host disease.',
    );
  });

  it('strips a leading email plus nav-label chrome so the bio opens on its subject', () => {
    expect(
      cleanPublicProfileBio({
        bio: 'faculty@yale.edu Website Professor Doe studies decision theory, game theory, and the economics of information.',
      }),
    ).toBe('Professor Doe studies decision theory, game theory, and the economics of information.');
  });

  it('strips a leading redacted-contact placeholder plus nav-label chrome', () => {
    expect(
      cleanPublicProfileBio({
        bio: '[email redacted] Website Dr. Doe studies the political economy of development and comparative institutions across regions.',
      }),
    ).toBe(
      'Dr. Doe studies the political economy of development and comparative institutions across regions.',
    );
  });

  it('strips trailing "Click here" call-to-action chrome from bios', () => {
    expect(
      cleanPublicProfileBio({
        bio: 'Professor Example studies the philosophical thought and writings of Plato and Aristotle. Click here for CV and further information.',
      }),
    ).toBe(
      'Professor Example studies the philosophical thought and writings of Plato and Aristotle.',
    );
  });

  it('recovers a bio when a leading dangling fragment precedes a subject-bearing sentence', () => {
    expect(
      cleanPublicProfileBio({
        bio: 'at the Betty Irene Moore School of Nursing at University of California Davis. Dr. Poghosyan studies the nursing workforce, primary care delivery, and health outcomes.',
      }),
    ).toBe(
      'Dr. Poghosyan studies the nursing workforce, primary care delivery, and health outcomes.',
    );
  });

  it('drops subject-less sentence-fragment bios with no recoverable subject', () => {
    const fragments = [
      'focus is the philosophical thought and writings of Plato and later Platonism through late antiquity.',
      'to move beyond the political borders of the nation-state to study South Asia and its diasporas.',
      'engage questions related to empire, colonialism, and the making of the modern Middle East.',
      'focuses on the norms, aspirations, and practices of scientists. My first book examined outer space.',
    ];
    for (const bio of fragments) {
      expect(cleanPublicProfileBio({ bio })).toBe('');
    }
  });

  it('does not turn stored official research-area blocks into public bios', () => {
    const rawProfile = {
      fname: 'Sam',
      lname: 'Raskin',
      bio: 'Research Areas\n\nAlgebra\nLanglands duality\nGeometric representation theory\nAlgebraic geometry\nHomotopy theory',
      profileUrls: {
        official: 'https://math.yale.edu/profile/sam-raskin/',
      },
    };

    const bio = cleanPublicProfileBio(rawProfile);

    expect(bio).toBe('');
  });
});
