import { researchEntityDescriptionIsCoherent } from '../services/studentVisibilityTier';
import { isCareerBiographyDescription } from '../utils/careerBiographyDescription';

const BODIES: Record<string, string> = {
  PROFILE_BIO:
    'Dr. Avery Lin is an immunologist at Yale University, where she teaches in the graduate immunology program, mentors postdoctoral trainees, and advises undergraduates on research careers.',
  NAME_LED_CAREER_BIO:
    'Avery Lin is an immunologist at Yale University, where she teaches in the graduate immunology program, mentors postdoctoral trainees, and advises undergraduates on research careers.',
  SYNTHESIZED_RESEARCH:
    'Investigates how mucosal immune cells restrain inflammation in the human intestine, using organoid co-culture and single-cell sequencing to map the signals that keep the epithelial barrier intact, and studies how the same regulatory circuits fail in inflammatory bowel disease.',
  OFFICIAL_RESEARCH_STATEMENT:
    'The Lin Laboratory studies how mucosal immune cells restrain intestinal inflammation, combining organoid co-culture, single-cell sequencing, and computational modeling to predict relapse in inflammatory bowel disease.',
  LAB_LABELLED_SYNTHESIS:
    'The Lin Laboratory investigates how mucosal immune cells restrain inflammation in the human intestine, using organoid co-culture and single-cell sequencing to map the signals that keep the epithelial barrier intact.',
  TWO_SENTENCE_CAREER_BIO:
    'Avery Lin is an immunologist at Yale University, where she teaches in the graduate immunology program and mentors postdoctoral trainees. She joined the faculty in 2016 after a residency in internal medicine and advises undergraduates on research careers.',
  ROLE_ONLY_STORED_BODY: 'Track Director of the Graduate Program in Molecular Biophysics.',
  EMPTY: '',
};

const baseEntity = {
  slug: 'fra-profile-lane-fixture',
  name: 'Avery Lin Faculty Research',
  kind: 'individual',
  entityType: 'FACULTY_RESEARCH_AREA',
  researchAreas: ['Immunology', 'Gastroenterology'],
  sourceUrls: ['https://medicine.example.edu/profile/avery_lin/'],
};

for (const [label, body] of Object.entries(BODIES)) {
  console.log(
    JSON.stringify({
      label,
      isCareerBio: isCareerBiographyDescription(body),
      coherent: researchEntityDescriptionIsCoherent({ ...baseEntity, fullDescription: body }, [
        'Avery Lin',
      ]),
      coherentNoLeadNames: researchEntityDescriptionIsCoherent({
        ...baseEntity,
        fullDescription: body,
      }),
    }),
  );
}
