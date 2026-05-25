import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Fellowship } from '../models/fellowship';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

interface PlannedProgramRepair {
  id: string;
  title: string;
  reason: string;
  update: Record<string, unknown>;
}

const normalizeForCompare = (value: unknown) => JSON.stringify(value ?? null);

function addRepairIfChanged(
  repairs: PlannedProgramRepair[],
  program: any,
  reason: string,
  update: Record<string, unknown>,
) {
  const changed = Object.entries(update).some(
    ([key, value]) => normalizeForCompare(program[key]) !== normalizeForCompare(value),
  );
  if (!changed) return;
  repairs.push({
    id: String(program._id),
    title: String(program.title || ''),
    reason,
    update,
  });
}

const isOfficialYaleUrl = (value: unknown): value is string =>
  typeof value === 'string' && /^https?:\/\/([^/]+\.)?yale\.edu\b/i.test(value.trim());

const isYaleCommunityForceFundUrl = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^https:\/\/yale\.communityforce\.com\/Funds\/FundDetails\.aspx\?/i.test(value.trim());

const isOfficialProgramSourceUrl = (value: unknown): value is string =>
  isOfficialYaleUrl(value) || isYaleCommunityForceFundUrl(value);

const slugifyKeyPart = (title: string) =>
  title
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const officialSourceUrlByExactTitle = new Map<string, string>([
  [
    'STARS Summer Research Program',
    'https://science.yalecollege.yale.edu/stem-fellowships/funding-stem-opportunities-yale/stars/stars-summer-research-program',
  ],
  [
    'Wu Tsai Undergraduate Fellowships',
    'https://wti.yale.edu/initiatives/undergraduate',
  ],
  [
    'Yale College First-Year Summer Research Fellowship in the Sciences and Engineering',
    'https://science.yalecollege.yale.edu/stem-fellowships/funding-stem-opportunities-yale/yale-college-first-year-summer-research-fellowship',
  ],
  [
    "Yale College Dean's Research Fellowship in the Sciences AND Rosenfeld Science Scholars Program",
    'https://science.yalecollege.yale.edu/yale-undergraduate-research/fellowship-grants/yale-college-deans-research-fellowship',
  ],
  [
    "Yale College Dean's Research Fellowship in the Humanities and Social Sciences",
    'https://yalecollege.yale.edu/life-yale/student-faculty-awards',
  ],
  [
    'Yale-Weizmann Israel Science Collaboration Program',
    'https://science.yalecollege.yale.edu/stem-fellowships/non-yale-research-opportunities',
  ],
]);

const YALE_OFFICE_RESEARCH_FELLOWSHIPS_SOURCE_URL =
  'https://funding.yale.edu/find-funding/yale-fellowships-offered-through';
const SAYBROOK_FELLOWSHIPS_SOURCE_URL =
  'https://saybrook.yale.edu/student-control-center/saybrook-fellowships';
const ARCHAEOLOGY_OPPORTUNITIES_SOURCE_URL = 'https://archaeology.yale.edu/opportunities';
const MACMILLAN_FELLOWSHIPS_SOURCE_URL = 'https://macmillan.yale.edu/fellowships-and-grants';
const DAVENPORT_FELLOWSHIPS_SOURCE_URL = 'https://davenport.yale.edu/student-info/fellowships-awards';
const SILLIMAN_FELLOWSHIPS_SOURCE_URL = 'https://silliman.yale.edu/resources/fellowships';
const HARVEY_GEIGER_ARCHITECTURE_SOURCE_URL =
  'https://www.architecture.yale.edu/academics/undergraduate-studies';
const MACMILLAN_EUROPE_FELLOWSHIPS_SOURCE_URL =
  'https://macmillan.yale.edu/europe/student-grants-and-fellowships';
const YALE_EXTERNAL_AWARDS_SOURCE_URL = 'https://funding.yale.edu/find-funding/external-awards-non-yale';
const STANLEY_BURNS_FELLOWSHIP_SOURCE_URL =
  'https://library.medicine.yale.edu/historical/research/grants-fellowships/burns-fellowship/';
const STEM_FELLOWSHIPS_SOURCE_URL =
  'https://science.yalecollege.yale.edu/stem-fellowships/funding-stem-opportunities-yale';
const CEAS_SOURCE_URL =
  'https://macmillan.yale.edu/eastasia/whitney-and-betty-macmillan-center-international-and-area-studies-yale';
const LINDSAY_FELLOWSHIP_SOURCE_URL =
  'https://macmillan.yale.edu/africa/lindsay-fellowship-research-africa-awardees';
const MOBLEY_FUNDING_SOURCE_URL =
  'https://careers.environment.yale.edu/resources/summer-experience-funding-sources/';
const NSF_REU_COMPUTATIONAL_INFECTIOUS_DISEASES_SOURCE_URL =
  'https://college.yale.edu/life-at-yale/student-faculty-awards/nsf-research-experience-for-undergraduates-reu-computational';
const MACMILLAN_HENRY_HART_RICE_SOURCE_URL =
  'https://macmillan.yale.edu/opportunities/henry-hart-rice-foreign-residence-fellowships';
const ECONOMICS_HERBERT_SCARF_SOURCE_URL =
  'https://economics.yale.edu/news/160216/herbert-scarf-summer-research-opportunities-applications-due-february-19';
const EZRA_STILES_AWARDS_SOURCE_URL = 'https://ezrastiles.yale.edu/about/awards';
const GRUBER_FELLOWSHIPS_SOURCE_URL =
  'https://law.yale.edu/centers-and-workshops/gruber-program-global-justice-and-womens-rights/gruber-fellowships';
const GRAND_STRATEGY_SOURCE_URL = 'https://jackson.yale.edu/academics/grand-strategy-program/';
const REEESNE_SMALL_GRANTS_SOURCE_URL = 'https://macmillan.yale.edu/reeesne/small-grants-students';
const YALE_OFFICE_FELLOWSHIPS_SOURCE_URL =
  'https://funding.yale.edu/find-funding/yale-fellowships-offered-through';
const CEAS_CIPE_SOURCE_URL =
  'https://macmillan.yale.edu/eastasia/center-international-and-professional-experience';
const SCHELL_HUMAN_RIGHTS_CAMPUS_SOURCE_URL =
  'https://law.yale.edu/schell/get-involved/human-rights-campus';
const YSE_SUMMER_FUNDING_SOURCE_URL =
  'https://careers.environment.yale.edu/resources/summer-experience-funding-sources/';

const yaleOfficeResearchFellowshipRepairs = new Map<
  string,
  {
    studentFacingCategory: string;
    summary: string;
    description: string;
    bestNextStep: string;
    prepSteps: string[];
    sourceKey: string;
  }
>([
  [
    'Fort Family Research Travel Fellowship',
    {
      studentFacingCategory: 'Undergraduate research travel funding',
      summary:
        'Yale College summer research travel fellowship for student projects related to the environment, clean energy, public transportation, or public health.',
      description:
        'The Fort Family Research Travel Fellowship is listed by Yale Office of Fellowships as a Yale-funded summer research fellowship. It supports undergraduate research travel tied to environmental, clean-energy, public-transportation, or public-health questions, especially in developing countries, remote locations, Native American reservations, Canada, or Guatemala.',
      bestNextStep:
        'Review the Yale Office of Fellowships summer fellowship guidance, then prepare a research plan, budget, and faculty-adviser context before applying through the Student Grants Database.',
      prepSteps: [
        'Yale Office of Fellowships guidance',
        'Research travel plan',
        'Faculty adviser context',
        'Budget',
        'Student Grants Database application',
      ],
      sourceKey: 'yale-office-of-fellowships:fort-family-research-travel-fellowship',
    },
  ],
  [
    'Friedman Family Travel/Research Fellowship',
    {
      studentFacingCategory: 'Undergraduate research travel funding',
      summary:
        'Yale College summer research fellowship for undergraduate projects related to urban development and urban studies.',
      description:
        'The Friedman Family Travel/Research Fellowship is listed by Yale Office of Fellowships as a Yale-funded summer research fellowship. It supports Yale undergraduates planning summer research projects related to urban development and urban studies in the United States or abroad.',
      bestNextStep:
        'Review the Yale Office of Fellowships summer fellowship guidance, then prepare a focused urban-studies research proposal, budget, and adviser context before applying.',
      prepSteps: [
        'Yale Office of Fellowships guidance',
        'Urban-studies research proposal',
        'Faculty adviser context',
        'Budget',
        'Student Grants Database application',
      ],
      sourceKey: 'yale-office-of-fellowships:friedman-family-travel-research-fellowship',
    },
  ],
  [
    'Jeffrey Lewis Summer Research and Travel Fellowship',
    {
      studentFacingCategory: 'Undergraduate summer research funding',
      summary:
        'Yale College summer fellowship supporting humanities, arts, and letters research projects for eligible first-years, sophomores, and juniors.',
      description:
        'The Jeffrey Lewis Summer Research and Travel Fellowship is listed by Yale Office of Fellowships as a Yale-funded summer research fellowship. It supports eligible Yale College students pursuing summer research projects in the humanities, arts, and letters.',
      bestNextStep:
        'Use the Yale Office of Fellowships guidance to confirm eligibility, then prepare a research plan, budget, and adviser context before applying.',
      prepSteps: [
        'Yale Office of Fellowships guidance',
        'Research plan',
        'Faculty adviser context',
        'Budget',
        'Student Grants Database application',
      ],
      sourceKey: 'yale-office-of-fellowships:jeffrey-lewis-summer-research-travel-fellowship',
    },
  ],
  [
    'Jehiel R. Elyachar Foundation Travel Fellowship',
    {
      studentFacingCategory: 'Undergraduate research travel funding',
      summary:
        'Yale College summer research travel fellowship for undergraduate projects related to Judaic Studies.',
      description:
        'The Jehiel R. Elyachar Foundation Travel Fellowship is listed by Yale Office of Fellowships as a Yale-funded summer research fellowship. It supports Yale undergraduates pursuing summer research or independent study related to Judaic Studies.',
      bestNextStep:
        'Review the Yale Office of Fellowships summer fellowship guidance, then prepare a Judaic Studies research proposal, budget, and adviser context before applying.',
      prepSteps: [
        'Yale Office of Fellowships guidance',
        'Judaic Studies research proposal',
        'Faculty adviser context',
        'Budget',
        'Student Grants Database application',
      ],
      sourceKey: 'yale-office-of-fellowships:jehiel-r-elyachar-foundation-travel-fellowship',
    },
  ],
  [
    'Lewis P. Curtis Fellowship',
    {
      studentFacingCategory: 'Undergraduate summer research funding',
      summary:
        'Yale College summer fellowship supporting international research in history, philosophy, arts, and letters.',
      description:
        'The Lewis P. Curtis Fellowship is listed by Yale Office of Fellowships as a Yale-funded summer research fellowship. It supports Yale College first-years, sophomores, and juniors pursuing international summer research in history, philosophy, and the arts and letters.',
      bestNextStep:
        'Review the Yale Office of Fellowships summer fellowship guidance, then prepare an international research plan, budget, and adviser context before applying.',
      prepSteps: [
        'Yale Office of Fellowships guidance',
        'International research plan',
        'Faculty adviser context',
        'Budget',
        'Student Grants Database application',
      ],
      sourceKey: 'yale-office-of-fellowships:lewis-p-curtis-fellowship',
    },
  ],
  [
    'Robert Lyons Danly 1969 Memorial Travel Fellowship',
    {
      studentFacingCategory: 'Undergraduate research travel funding',
      summary:
        'Yale College summer research travel fellowship for undergraduate research or independent study in Japan.',
      description:
        'The Robert Lyons Danly 1969 Memorial Travel Fellowship is listed by Yale Office of Fellowships as a Yale-funded summer research fellowship. It supports Yale undergraduates pursuing summer research or independent study in Japan, excluding language study.',
      bestNextStep:
        'Review the Yale Office of Fellowships summer fellowship guidance, then prepare a Japan-focused research plan, budget, and adviser context before applying.',
      prepSteps: [
        'Yale Office of Fellowships guidance',
        'Japan-focused research plan',
        'Faculty adviser context',
        'Budget',
        'Student Grants Database application',
      ],
      sourceKey: 'yale-office-of-fellowships:robert-lyons-danly-1969-memorial-travel-fellowship',
    },
  ],
  [
    'Robert S. Kilborne Memorial Traveling Scholarship',
    {
      studentFacingCategory: 'Undergraduate research travel funding',
      summary:
        'Yale College summer research travel scholarship for independent research in England related to literature, history, or the arts.',
      description:
        'The Robert S. Kilborne Memorial Traveling Scholarship is listed by Yale Office of Fellowships as a Yale-funded summer research fellowship. It supports Yale College first-years, sophomores, and juniors pursuing summer independent research in England on English literature, history, or the arts.',
      bestNextStep:
        'Review the Yale Office of Fellowships summer fellowship guidance, then prepare an England-focused independent research proposal, budget, and adviser context before applying.',
      prepSteps: [
        'Yale Office of Fellowships guidance',
        'Independent research proposal',
        'Faculty adviser context',
        'Budget',
        'Student Grants Database application',
      ],
      sourceKey: 'yale-office-of-fellowships:robert-s-kilborne-memorial-traveling-scholarship',
    },
  ],
]);

const saybrookResearchFellowshipRepairs = new Map<
  string,
  {
    studentFacingCategory: string;
    summary: string;
    description: string;
    bestNextStep: string;
    prepSteps: string[];
    compensationSummary: string;
    sourceKey: string;
  }
>([
  [
    'Bruce M. Babcock 62 Travel Research Fellowship',
    {
      studentFacingCategory: 'Residential college research travel funding',
      summary:
        'Saybrook College travel research fellowship for Saybrook students pursuing a research project in the United States or abroad.',
      description:
        'The Bruce M. Babcock Travel Research Fellowship is administered by Saybrook College and provides travel funds for Saybrook students pursuing a research project in the United States or abroad. It is college-restricted funding, not a general Yale-wide research placement.',
      bestNextStep:
        'Review the Saybrook fellowships page, confirm the current deadline, and prepare the Student Grants Database application and post-award report plan.',
      prepSteps: [
        'Official Saybrook fellowships page',
        'Research travel plan',
        'Budget',
        'Student Grants Database application',
        'Post-award report plan',
      ],
      compensationSummary: 'Up to $1,200 when awarded',
      sourceKey: 'saybrook-college:bruce-m-babcock-travel-research-fellowship',
    },
  ],
  [
    'Saybrook College Research Fellowship',
    {
      studentFacingCategory: 'Residential college research funding',
      summary:
        'Saybrook College research fellowship for first-years, sophomores, and juniors pursuing independent study, research, research internships, or research-team work.',
      description:
        'The Saybrook College Research Fellowship funds Saybrook students pursuing independent study and research, including research internships or being part of a research team. It is intended for Saybrook first-years, sophomores, and juniors and requires the standard Yale fellowships application process.',
      bestNextStep:
        'Review the Saybrook fellowships page, confirm eligibility and deadline, then prepare the Student Grants Database application around a specific research plan.',
      prepSteps: [
        'Official Saybrook fellowships page',
        'Saybrook eligibility check',
        'Research plan',
        'Student Grants Database application',
        'Post-award report plan',
      ],
      compensationSummary: 'Up to $1,000 when awarded',
      sourceKey: 'saybrook-college:research-fellowship',
    },
  ],
]);

const reviewedResidentialCollegeResearchFundingRepairs = new Map<
  string,
  {
    sourceUrl: string;
    studentFacingCategory: string;
    summary: string;
    description: string;
    bestNextStep: string;
    prepSteps: string[];
    sourceKey: string;
    studentVisibilityOverrideTier?: 'limited_but_safe';
  }
>([
  [
    'Berkeley College Mellon Senior Research Grant',
    {
      sourceUrl: 'https://commonplace.yale.edu/mellon-forum-undergraduate-research-grants',
      studentFacingCategory: 'Residential college senior research funding',
      summary: 'Berkeley College Mellon Forum research grant for seniors presenting independent research through the Commonplace Society.',
      description:
        'The Berkeley College Mellon Forum Undergraduate Research Grants support seniors participating in the Commonplace Society with funding toward a research project. The source directs students to search the Student Grants Database for the Berkeley College Mellon Senior Research Grant.',
      bestNextStep:
        'Review the Commonplace Society Mellon grant page, confirm Berkeley eligibility, and prepare the Student Grants Database application around a senior research project.',
      prepSteps: [
        'Official Berkeley/Commonplace page',
        'Senior research project',
        'Commonplace Society participation',
        'Student Grants Database application',
      ],
      sourceKey: 'berkeley-commonplace:mellon-forum-undergraduate-research-grants',
    },
  ],
  [
    'Branford College Mellon Senior Research Grant',
    {
      sourceUrl: 'https://branford.yale.edu/head-of-branford-college/student-project-funding',
      studentFacingCategory: 'Residential college senior research funding',
      summary: 'Branford College Mellon funding for seniors working on senior essays, projects, or analogous independent research.',
      description:
        'Branford College describes its Mellon Senior Research Grant as funding for seniors to support senior essays, projects, or analogous forms of research and independent study, with faculty-adviser approval and a presentation expectation.',
      bestNextStep:
        'Review Branford student project funding, confirm college eligibility, and prepare a one-page project description plus faculty-adviser reference.',
      prepSteps: [
        'Official Branford funding page',
        'Senior essay or project plan',
        'Faculty-adviser approval',
        'Student Grants Database application',
      ],
      sourceKey: 'branford-college:mellon-senior-research-grant',
    },
  ],
  [
    'Branford College Richter Summer Fellowship',
    {
      sourceUrl: 'https://branford.yale.edu/head-of-branford-college/student-project-funding',
      studentFacingCategory: 'Residential college summer research funding',
      summary: 'Branford College Richter funding for independent summer study or research projects.',
      description:
        'Branford College describes Richter Fund Awards as support for independent study and research, including internships or research-team participation only when the primary component is study or research.',
      bestNextStep:
        'Review Branford student project funding, confirm eligibility, and prepare a summer research proposal and budget.',
      prepSteps: [
        'Official Branford funding page',
        'Independent summer research plan',
        'Budget',
        'Student Grants Database application',
      ],
      sourceKey: 'branford-college:richter-summer-fellowship',
    },
  ],
  [
    'Davenport College Mellon Senior Research Grant',
    {
      sourceUrl: DAVENPORT_FELLOWSHIPS_SOURCE_URL,
      studentFacingCategory: 'Residential college senior research funding',
      summary: 'Davenport College Mellon Research Award for seniors pursuing independent research.',
      description:
        'Davenport College lists the Mellon Research Award as residential-college funding for seniors independent research. This should be shown as college-restricted research funding, not as a general Yale-wide research placement.',
      bestNextStep:
        'Review Davenport fellowships and awards, confirm college eligibility, and prepare the Student Grants Database application around a senior research project.',
      prepSteps: [
        'Official Davenport fellowships page',
        'Senior research project',
        'Budget',
        'Student Grants Database application',
      ],
      sourceKey: 'davenport-college:mellon-senior-research-grant',
    },
  ],
  [
    'Davenport College Richter Summer Fellowship',
    {
      sourceUrl: DAVENPORT_FELLOWSHIPS_SOURCE_URL,
      studentFacingCategory: 'Residential college summer research funding',
      summary: 'Davenport College Richter Summer Fellowship for independent summer research.',
      description:
        'Davenport College lists the Richter Summer Fellowship as residential-college funding for independent summer research. This should be shown as college-restricted research funding, not as a general Yale-wide research placement.',
      bestNextStep:
        'Review Davenport fellowships and awards, confirm college eligibility, and prepare the Student Grants Database application around an independent summer research plan.',
      prepSteps: [
        'Official Davenport fellowships page',
        'Independent summer research plan',
        'Budget',
        'Student Grants Database application',
      ],
      sourceKey: 'davenport-college:richter-summer-fellowship',
    },
  ],
  [
    'Morse College Mellon Senior Research Grant',
    {
      sourceUrl: 'https://morse.yale.edu/head-of-colleges-office/fellowships-grants',
      studentFacingCategory: 'Residential college senior research funding',
      summary: 'Morse College Mellon Senior Research Award for seniors independent research.',
      description:
        'Morse College lists the Mellon Senior Research Award as funding for seniors independent research. This should be shown as college-restricted research funding, not as a general Yale-wide research placement.',
      bestNextStep:
        'Review Morse fellowships and grants, confirm college eligibility, and prepare the Student Grants Database application around a senior research project.',
      prepSteps: [
        'Official Morse fellowships page',
        'Senior research project',
        'Budget',
        'Student Grants Database application',
      ],
      sourceKey: 'morse-college:mellon-senior-research-grant',
    },
  ],
  [
    'Morse College Richter Summer Fellowship',
    {
      sourceUrl: 'https://morse.yale.edu/head-of-colleges-office/fellowships-grants',
      studentFacingCategory: 'Residential college summer research funding',
      summary: 'Morse College Richter Summer Fellowship for independent summer research.',
      description:
        'Morse College lists the Richter Summer Fellowship as funding for independent summer research. This should be shown as college-restricted research funding, not as a general Yale-wide research placement.',
      bestNextStep:
        'Review Morse fellowships and grants, confirm college eligibility, and prepare the Student Grants Database application around an independent summer research plan.',
      prepSteps: [
        'Official Morse fellowships page',
        'Independent summer research plan',
        'Budget',
        'Student Grants Database application',
      ],
      sourceKey: 'morse-college:richter-summer-fellowship',
    },
  ],
  [
    'Pauli Murray College Richter Summer Fellowship',
    {
      sourceUrl: 'https://paulimurray.yalecollege.yale.edu/student-information/fellowships-grants',
      studentFacingCategory: 'Residential college summer research funding',
      summary: 'Pauli Murray College Richter Summer Fellowship for independent summer study or research.',
      description:
        'Pauli Murray College lists the Richter Summer Fellowship as residential-college funding for independent summer study or research. This should be shown as college-restricted research funding, not as a general Yale-wide research placement.',
      bestNextStep:
        'Review Pauli Murray fellowships and grants, confirm college eligibility, and prepare the Student Grants Database application around an independent summer research plan.',
      prepSteps: [
        'Official Pauli Murray fellowships page',
        'Independent summer research plan',
        'Budget',
        'Student Grants Database application',
      ],
      sourceKey: 'pauli-murray-college:richter-summer-fellowship',
    },
  ],
  [
    'Pauli Murray Mellon Research Fellowship for Seniors',
    {
      sourceUrl: 'https://paulimurray.yalecollege.yale.edu/student-information/fellowships-grants',
      studentFacingCategory: 'Residential college senior research funding',
      summary: 'Pauli Murray College Mellon Research Fellowship for seniors pursuing independent research.',
      description:
        'Pauli Murray College lists the Mellon Research Fellowship for Seniors as residential-college funding for senior research. This should be shown as college-restricted research funding, not as a general Yale-wide research placement.',
      bestNextStep:
        'Review Pauli Murray fellowships and grants, confirm college eligibility, and prepare the Student Grants Database application around a senior research project.',
      prepSteps: [
        'Official Pauli Murray fellowships page',
        'Senior research project',
        'Budget',
        'Student Grants Database application',
      ],
      sourceKey: 'pauli-murray-college:mellon-research-fellowship-seniors',
    },
  ],
  [
    'Saybrook College Mellon Senior Research Grant',
    {
      sourceUrl: SAYBROOK_FELLOWSHIPS_SOURCE_URL,
      studentFacingCategory: 'Residential college senior research funding',
      summary: 'Saybrook College Mellon undergraduate research funding for seniors pursuing academic-year research.',
      description:
        'Saybrook College lists Mellon Undergraduate Research Awards for seniors pursuing academic-year research, with a Senior Mellon Forum or other presentation expectation.',
      bestNextStep:
        'Review Saybrook fellowships, confirm college eligibility, and prepare the Student Grants Database application around a senior research project.',
      prepSteps: [
        'Official Saybrook fellowships page',
        'Senior research project',
        'Presentation expectation',
        'Student Grants Database application',
      ],
      sourceKey: 'saybrook-college:mellon-senior-research-grant',
    },
  ],
  [
    'Saybrook College Richter Summer Fellowship',
    {
      sourceUrl: SAYBROOK_FELLOWSHIPS_SOURCE_URL,
      studentFacingCategory: 'Residential college summer research funding',
      summary: 'Saybrook College Richter Summer Fellowship for independent summer study or research.',
      description:
        'Saybrook College lists the Richter Summer Fellowship as funding for independent study or research. This should be shown as college-restricted research funding, not as a general Yale-wide research placement.',
      bestNextStep:
        'Review Saybrook fellowships, confirm college eligibility, and prepare the Student Grants Database application around an independent summer research plan.',
      prepSteps: [
        'Official Saybrook fellowships page',
        'Independent summer research plan',
        'Budget',
        'Student Grants Database application',
      ],
      sourceKey: 'saybrook-college:richter-summer-fellowship',
    },
  ],
  [
    'Silliman College Mellon Senior Research Grant',
    {
      sourceUrl: SILLIMAN_FELLOWSHIPS_SOURCE_URL,
      studentFacingCategory: 'Residential college senior research funding',
      summary: 'Silliman College Mellon Research Grant for seniors pursuing faculty-supervised academic-year research.',
      description:
        'Silliman College lists the Mellon Research Grant as support for Silliman seniors pursuing research during the academic year under the supervision of a Yale faculty member.',
      bestNextStep:
        'Review Silliman fellowships, confirm college eligibility, and prepare the Student Grants Database application around a faculty-supervised senior research project.',
      prepSteps: [
        'Official Silliman fellowships page',
        'Faculty-supervised research project',
        'Budget',
        'Student Grants Database application',
      ],
      sourceKey: 'silliman-college:mellon-senior-research-grant',
    },
  ],
  [
    'Silliman College Richter Summer Fellowship',
    {
      sourceUrl: SILLIMAN_FELLOWSHIPS_SOURCE_URL,
      studentFacingCategory: 'Residential college summer research funding',
      summary: 'Silliman College Richter Summer Fellowship for independent summer study or research.',
      description:
        'Silliman College lists the Richter Summer Fellowship as an award for independent study and research, not for general travel, work, or school enrollment.',
      bestNextStep:
        'Review Silliman fellowships, confirm college eligibility, and prepare the Student Grants Database application around an independent summer research plan.',
      prepSteps: [
        'Official Silliman fellowships page',
        'Independent summer research plan',
        'Budget',
        'Student Grants Database application',
      ],
      sourceKey: 'silliman-college:richter-summer-fellowship',
    },
  ],
  [
    'Trumbull College Mellon Research Grant',
    {
      sourceUrl: 'https://trumbull.yalecollege.yale.edu/masters-office/trumbull-college-awards',
      studentFacingCategory: 'Residential college senior research funding',
      summary: 'Trumbull College Mellon Research Grant for Trumbull seniors and juniors, with senior projects prioritized.',
      description:
        'Trumbull College lists the Mellon Research Grant as college funding for Trumbull seniors and juniors, with senior research projects prioritized. This should be shown as college-restricted research funding.',
      bestNextStep:
        'Review Trumbull college awards, confirm college eligibility, and prepare the Student Grants Database application around a research project.',
      prepSteps: [
        'Official Trumbull awards page',
        'Research project',
        'Budget',
        'Student Grants Database application',
      ],
      sourceKey: 'trumbull-college:mellon-research-grant',
    },
  ],
  [
    'Trumbull College Richter Summer Fellowship',
    {
      sourceUrl: 'https://trumbull.yalecollege.yale.edu/masters-office/trumbull-college-awards',
      studentFacingCategory: 'Residential college summer research funding',
      summary: 'Trumbull College Richter Summer Fellowship for independent summer study or research.',
      description:
        'Trumbull College lists the Richter Summer Fellowship as funding for independent study and research. This should be shown as college-restricted research funding.',
      bestNextStep:
        'Review Trumbull college awards, confirm college eligibility, and prepare the Student Grants Database application around an independent summer research plan.',
      prepSteps: [
        'Official Trumbull awards page',
        'Independent summer research plan',
        'Budget',
        'Student Grants Database application',
      ],
      sourceKey: 'trumbull-college:richter-summer-fellowship',
    },
  ],
]);

const reviewedAreaStudiesProgramRepairs = new Map<
  string,
  {
    sourceUrl: string;
    studentFacingCategory: string;
    summary: string;
    description: string;
    bestNextStep: string;
    prepSteps: string[];
    sourceKey: string;
    studentVisibilityOverrideTier?: 'limited_but_safe';
  }
>([
  [
    'CMES Ganzfried Family Travel Fellowship',
    {
      sourceUrl: 'https://macmillan.yale.edu/middleeast/grants',
      studentFacingCategory: 'Area-studies research travel funding',
      summary: 'CMES travel fellowship for Yale students pursuing research in Jewish Studies.',
      description:
        'The Ganzfried Family Travel Fellowship is listed by the Council on Middle East Studies as funding for Yale students pursuing research in Jewish Studies. Because the source is an area-studies funding page rather than a structured placement, keep the copy focused on funding for a student-defined project.',
      bestNextStep:
        'Review the official CMES grants page, confirm eligibility, and prepare a research proposal, budget, and recommendation materials.',
      prepSteps: ['Official CMES grants page', 'Research proposal', 'Budget', 'Recommendation materials'],
      sourceKey: 'macmillan-cmes:ganzfried-family-travel-fellowship',
      studentVisibilityOverrideTier: 'limited_but_safe',
    },
  ],
  [
    'CMES Libby Rouse Fund for Peace Fellowships',
    {
      sourceUrl: 'https://macmillan.yale.edu/middleeast/grants',
      studentFacingCategory: 'Area-studies research funding',
      summary: 'CMES fellowship funding for Yale students whose work focuses on the Middle East or parts of Central Asia.',
      description:
        'The Libby Rouse Fund for Peace Fellowships are listed by the Council on Middle East Studies as support for Yale students whose work focuses on the Middle East or Tajikistan, Turkmenistan, or Uzbekistan. Keep this framed as project funding rather than a research placement.',
      bestNextStep:
        'Review the official CMES grants page, confirm regional fit, and prepare a project proposal and budget before applying.',
      prepSteps: ['Official CMES grants page', 'Regional project fit', 'Project proposal', 'Budget'],
      sourceKey: 'macmillan-cmes:libby-rouse-fund-for-peace-fellowships',
      studentVisibilityOverrideTier: 'limited_but_safe',
    },
  ],
  [
    'Council on East Asian Studies Senior Essay Research Grants',
    {
      sourceUrl: 'https://macmillan.yale.edu/eastasia/opportunities/ceas-senior-essay-research-grants',
      studentFacingCategory: 'Undergraduate senior essay research funding',
      summary: 'CEAS grant supporting Yale College undergraduate research for senior essays focused on East Asia.',
      description:
        'The Council on East Asian Studies Senior Essay Research Grants support Yale College undergraduate research in preparation for senior essays focused on East Asia, with applications for research during summer or the academic year.',
      bestNextStep:
        'Review the CEAS Senior Essay Research Grants page, confirm language and regional fit, and prepare the Student Grants Database application.',
      prepSteps: ['Official CEAS page', 'Senior essay research plan', 'Language preparation', 'Student Grants Database application'],
      sourceKey: 'macmillan-ceas:senior-essay-research-grants',
    },
  ],
  [
    'Council on Southeast Asia Studies Grants',
    {
      sourceUrl: 'https://macmillan.yale.edu/southeast-asia/council-southeast-asia-studies-grant',
      studentFacingCategory: 'Area-studies research funding',
      summary: 'CSEAS grants for Yale undergraduate and graduate students with research or study connected to Southeast Asia.',
      description:
        'The Council on Southeast Asia Studies Grant supports research-related purposes for Yale undergraduate and graduate students with a demonstrated commitment to Southeast Asian studies. Keep this framed as funding for a student-defined research or study plan.',
      bestNextStep:
        'Review the CSEAS grant page, confirm Southeast Asia fit, and prepare a project proposal, budget, and recommendation materials.',
      prepSteps: ['Official CSEAS page', 'Project proposal', 'Budget', 'Recommendation materials'],
      sourceKey: 'macmillan-cseas:council-on-southeast-asia-studies-grant',
      studentVisibilityOverrideTier: 'limited_but_safe',
    },
  ],
  [
    'European Union Studies Grants',
    {
      sourceUrl: 'https://macmillan.yale.edu/europe/eustudies/european-union-studies-grants-fellowships',
      studentFacingCategory: 'Area-studies research funding',
      summary: 'European Union Studies grants for Yale students pursuing research on the European Union or European integration.',
      description:
        'The European Union Studies Program lists grants for undergraduate and graduate students whose work or research involves the European Union or European integration. Keep this framed as funding for a student-defined project rather than a placement.',
      bestNextStep:
        'Review the European Union Studies grants page, confirm project fit, and prepare the application materials around a focused research plan.',
      prepSteps: ['Official EU Studies page', 'Research plan', 'Budget', 'Application materials'],
      sourceKey: 'macmillan-europe:european-union-studies-grants',
      studentVisibilityOverrideTier: 'limited_but_safe',
    },
  ],
  [
    'Georg Walter Leitner Program in International and Comparative Political Economy Grants',
    {
      sourceUrl: 'https://macmillan.yale.edu/leitner/research-grants',
      studentFacingCategory: 'Political economy research funding',
      summary: 'Leitner Program grants for Yale students pursuing research in international and comparative political economy.',
      description:
        'The Georg Walter Leitner Program offers research grants to Yale graduate and undergraduate students working on international and comparative political economy, including senior essay and travel fellowship support.',
      bestNextStep:
        'Review the Leitner research grants page, confirm political-economy fit, and prepare a project proposal and budget.',
      prepSteps: ['Official Leitner grants page', 'Political-economy research fit', 'Project proposal', 'Budget'],
      sourceKey: 'macmillan-leitner:international-comparative-political-economy-grants',
      studentVisibilityOverrideTier: 'limited_but_safe',
    },
  ],
  [
    'Harold C. Conklin Research Fellowship in the Philippines',
    {
      sourceUrl: 'https://macmillan.yale.edu/southeast-asia/harold-c-conklin-research-fellowship',
      studentFacingCategory: 'Area-studies research funding',
      summary: 'CSEAS fellowship for Yale students conducting primary-source or direct research in the Philippines.',
      description:
        'The Harold C. Conklin Research Fellowship in the Philippines supports Yale graduate or undergraduate students conducting primary-source or direct research in the Philippines.',
      bestNextStep:
        'Review the official fellowship page, confirm Philippines research fit, and prepare the Student Grants Database application.',
      prepSteps: ['Official CSEAS page', 'Philippines research plan', 'Budget', 'Student Grants Database application'],
      sourceKey: 'macmillan-cseas:harold-c-conklin-research-fellowship',
      studentVisibilityOverrideTier: 'limited_but_safe',
    },
  ],
  [
    'Keggi-Berzins Fellowships for Baltic Studies',
    {
      sourceUrl: 'https://macmillan.yale.edu/baltic/keggi-berzins-fellowship-baltic-studies',
      studentFacingCategory: 'Area-studies research or language funding',
      summary: 'Baltic Studies fellowship for current Yale students pursuing research or language study in or about Baltic countries.',
      description:
        'The Keggi-Berzins Fellowship for Baltic Studies supports current Yale undergraduate and graduate students pursuing research or language study in or about Baltic countries.',
      bestNextStep:
        'Review the official Baltic Studies fellowship page, confirm regional fit, and prepare the project or language-study application.',
      prepSteps: ['Official Baltic Studies page', 'Regional project fit', 'Project or language-study plan', 'Budget'],
      sourceKey: 'macmillan-baltic:keggi-berzins-fellowship',
      studentVisibilityOverrideTier: 'limited_but_safe',
    },
  ],
  [
    'Latin American and Iberian Studies Summer Travel Awards',
    {
      sourceUrl: 'https://macmillan.yale.edu/latam/student-grants-and-prizes',
      studentFacingCategory: 'Area-studies research travel funding',
      summary: 'CLAIS summer travel funding for junior undergraduates and graduate students conducting research in Latin America, the Caribbean, Portugal, or Spain.',
      description:
        'The Council on Latin American and Iberian Studies lists summer travel grants for junior undergraduates and graduate students planning research or study abroad in Latin America, the Caribbean, Portugal, or Spain.',
      bestNextStep:
        'Review the CLAIS grants page, confirm regional fit, and prepare the Student Grants Database application with a focused research or study plan.',
      prepSteps: ['Official CLAIS grants page', 'Regional research or study plan', 'Budget', 'Student Grants Database application'],
      sourceKey: 'macmillan-clais:summer-travel-awards',
      studentVisibilityOverrideTier: 'limited_but_safe',
    },
  ],
  [
    'South Asian Studies Rustgi Fellowships',
    {
      sourceUrl: 'https://macmillan.yale.edu/southasia/rustgi-fellowships',
      studentFacingCategory: 'Area-studies research funding',
      summary: 'South Asian Studies Council Rustgi funding for Yale students pursuing South Asia-focused research or study.',
      description:
        'The South Asian Studies Council lists Rustgi Fellowships as support for Yale students pursuing South Asia-focused research or study, with undergraduate evidence and undergraduate preference in related SASC guidance.',
      bestNextStep:
        'Review the Rustgi Fellowship page and undergraduate grants guidance, then prepare a South Asia-focused proposal and budget.',
      prepSteps: ['Official SASC Rustgi page', 'South Asia project fit', 'Proposal', 'Budget'],
      sourceKey: 'macmillan-southasia:rustgi-fellowships',
      studentVisibilityOverrideTier: 'limited_but_safe',
    },
  ],
  [
    'South Asian Studies Senior Essay Research Grant',
    {
      sourceUrl: 'https://macmillan.yale.edu/southasia/undergraduate-grants',
      studentFacingCategory: 'Undergraduate senior essay research funding',
      summary: 'South Asian Studies Council grant supporting undergraduate senior essay research related to South Asia.',
      description:
        'The South Asian Studies Council undergraduate grants page lists a Senior Essay Research Grant supporting undergraduate research for South Asian Studies senior essays.',
      bestNextStep:
        'Review the SASC undergraduate grants page and prepare a senior essay research proposal and budget.',
      prepSteps: ['Official SASC undergraduate grants page', 'Senior essay research plan', 'Budget', 'Student Grants Database application'],
      sourceKey: 'macmillan-southasia:senior-essay-research-grant',
    },
  ],
  [
    'South Asian Studies Travel Research Grant for Undergraduate Students',
    {
      sourceUrl: 'https://macmillan.yale.edu/southasia/undergraduate-grants',
      studentFacingCategory: 'Undergraduate research travel funding',
      summary: 'South Asian Studies Council travel research grant for Yale undergraduates studying South Asian history, society, languages, or culture.',
      description:
        'The South Asian Studies Council undergraduate grants page lists a travel research grant for Yale undergraduates studying South Asian history, society, languages, or culture in the United States or internationally.',
      bestNextStep:
        'Review the SASC undergraduate grants page and prepare a South Asia-focused travel research plan and budget.',
      prepSteps: ['Official SASC undergraduate grants page', 'Travel research plan', 'Budget', 'Student Grants Database application'],
      sourceKey: 'macmillan-southasia:travel-research-grant-undergraduates',
    },
  ],
]);

const reviewedProgramSuppressions = new Map<
  string,
  {
    sourceUrl: string;
    summary: string;
    description: string;
    bestNextStep: string;
    sourceKey: string;
    suppressionReason: string;
  }
>([
  [
    'Council on African Studies - Graduate Student Conference/Research Award',
    {
      sourceUrl: 'https://macmillan.yale.edu/africa/cas-graduate-conferenceresearch-award',
      summary: 'Graduate-student conference and research award for Africa-related research or conference travel.',
      description:
        'The official Council on African Studies page describes this as a graduate-student conference and research award, not an undergraduate research-entry program.',
      bestNextStep:
        'Keep suppressed unless the product adds a graduate/professional fellowship surface.',
      sourceKey: 'macmillan-africa:graduate-student-conference-research-award',
      suppressionReason: 'graduate_or_professional_only',
    },
  ],
  [
    'Council on East Asian Studies Field Research Grants',
    {
      sourceUrl: 'https://macmillan.yale.edu/eastasia/opportunities/ceas-field-research-grants',
      summary: 'Graduate field-research grant for doctoral dissertation research in East Asian studies.',
      description:
        'The official CEAS page limits Field Research Grants to registered Yale graduate students engaged in doctoral dissertation research, so this is not an undergraduate research-entry program.',
      bestNextStep:
        'Keep suppressed unless the product adds a graduate dissertation-research funding surface.',
      sourceKey: 'macmillan-ceas:field-research-grants',
      suppressionReason: 'graduate_or_professional_only',
    },
  ],
  [
    'Georges Lurcy Travel Fellowship for Research in France',
    {
      sourceUrl: 'https://macmillan.yale.edu/graduate-professional-student-grants',
      summary: 'Graduate or doctoral travel fellowship for dissertation-related French Studies research.',
      description:
        'MacMillan graduate/professional grants guidance describes the Georges Lurcy Travel Fellowship as support for graduate or doctoral research in France, not an undergraduate research-entry program.',
      bestNextStep:
        'Keep suppressed unless the product adds a graduate dissertation-research funding surface.',
      sourceKey: 'macmillan-center:georges-lurcy-travel-fellowship',
      suppressionReason: 'graduate_or_professional_only',
    },
  ],
  [
    'MacMillan Center Pre-Dissertation Research Fellowships',
    {
      sourceUrl: 'https://macmillan.yale.edu/graduate-professional-student-grants',
      summary: 'Graduate pre-dissertation research fellowship, not an undergraduate program.',
      description:
        'MacMillan graduate/professional grants guidance describes the Pre-Dissertation Research Fellowships as support for PhD candidates and limited named master’s programs, not undergraduate research entry.',
      bestNextStep:
        'Keep suppressed unless the product adds a graduate pre-dissertation funding surface.',
      sourceKey: 'macmillan-center:pre-dissertation-research-fellowships',
      suppressionReason: 'graduate_or_professional_only',
    },
  ],
  [
    'MacMillan International Dissertation Research Fellowships (IDRF)',
    {
      sourceUrl: 'https://macmillan.yale.edu/graduate-professional-student-grants',
      summary: 'International dissertation research fellowship for PhD students.',
      description:
        'MacMillan graduate/professional grants guidance describes IDRF as support for PhD students engaged in international dissertation research, not undergraduate research entry.',
      bestNextStep:
        'Keep suppressed unless the product adds a graduate dissertation-research funding surface.',
      sourceKey: 'macmillan-center:international-dissertation-research-fellowships',
      suppressionReason: 'graduate_or_professional_only',
    },
  ],
  [
    'South Asian Studies Summer Research Awards for Graduate Students',
    {
      sourceUrl: 'https://macmillan.yale.edu/southasia/graduate',
      summary: 'South Asian Studies summer research awards for graduate students.',
      description:
        'The South Asian Studies graduate page limits this award to qualified graduate students doing pre-dissertation research or language study relevant to doctoral work.',
      bestNextStep:
        'Keep suppressed unless the product adds a graduate pre-dissertation funding surface.',
      sourceKey: 'macmillan-southasia:summer-research-awards-graduate-students',
      suppressionReason: 'graduate_or_professional_only',
    },
  ],
  [
    'Beinecke Library Research Fellowships for Yale Graduate and Professional Students',
    {
      sourceUrl: 'https://beinecke.library.yale.edu/programs/fellowships/research-fellowships-graduate-students',
      summary: 'Beinecke Library graduate-student research fellowship for onsite special-collections work.',
      description:
        'The official Beinecke Library page describes this as a research fellowship for Yale graduate and professional students, not an undergraduate research-entry program.',
      bestNextStep:
        'Keep suppressed unless the product adds a graduate/professional fellowship surface.',
      sourceKey: 'beinecke-library:graduate-student-research-fellowships',
      suppressionReason: 'graduate_or_professional_only',
    },
  ],
  [
    'Global Rhodes Scholarship',
    {
      sourceUrl: 'https://funding.yale.edu/funding-postgraduate-opportunities',
      summary: 'External postgraduate scholarship route, not a Yale undergraduate research-entry program.',
      description:
        'The Global Rhodes Scholarship is a postgraduate award route. It should not appear in undergraduate research-program browse by default.',
      bestNextStep:
        'Keep suppressed unless the product adds a postgraduate fellowships surface.',
      sourceKey: 'yale-office-of-fellowships:global-rhodes-scholarship',
      suppressionReason: 'external_postgraduate_award',
    },
  ],
  [
    'Graduate Affiliate Fellows with Program in Agrarian Studies',
    {
      sourceUrl: 'https://macmillan.yale.edu/agrarian/graduate-affiliate-fellowship',
      summary: 'Agrarian Studies graduate affiliate fellowship for Yale PhD students.',
      description:
        'The official Program in Agrarian Studies page describes this as a fellowship for Yale PhD students participating in the Agrarian Studies community and dissertation-related work.',
      bestNextStep:
        'Keep suppressed unless the product adds a graduate fellowship surface.',
      sourceKey: 'macmillan-agrarian:graduate-affiliate-fellowship',
      suppressionReason: 'graduate_or_professional_only',
    },
  ],
  [
    'Graduate Research Fellowships of the Gilder Lehrman Center',
    {
      sourceUrl: 'https://macmillan.yale.edu/glc/summer-graduate-research-fellowships',
      summary: 'Gilder Lehrman Center summer research funding for Yale graduate students.',
      description:
        'The official Gilder Lehrman Center page describes this as summer research funding for Yale graduate students, not undergraduate research entry.',
      bestNextStep:
        'Keep suppressed unless the product adds a graduate fellowship surface.',
      sourceKey: 'macmillan-glc:summer-graduate-research-fellowships',
      suppressionReason: 'graduate_or_professional_only',
    },
  ],
  [
    'Grand Strategy Dissertation Research Award',
    {
      sourceUrl: 'https://jackson.yale.edu/academics/grand-strategy-program/fellowships-awards/',
      summary: 'Grand Strategy dissertation research award for graduate-level work.',
      description:
        'The official Jackson School page frames this as graduate student travel or research funding for dissertation-level work, not undergraduate research entry.',
      bestNextStep:
        'Keep suppressed unless the product adds a graduate dissertation-research funding surface.',
      sourceKey: 'jackson-grand-strategy:dissertation-research-award',
      suppressionReason: 'graduate_or_professional_only',
    },
  ],
  [
    'Heyman Federal Public Service Fellowship Program - Yale Law School',
    {
      sourceUrl: 'https://law.yale.edu/student-life/career-development/students/career-pathways/public-interest/public-interest-fellowships',
      summary: 'Yale Law School public-service fellowship route, not an undergraduate research-entry program.',
      description:
        'The official Yale Law School source describes public-interest fellowship options for law-school students or graduates, not undergraduate research entry.',
      bestNextStep:
        'Keep suppressed unless the product adds a law-school or postgraduate fellowship surface.',
      sourceKey: 'yale-law-school:heyman-federal-public-service-fellowship',
      suppressionReason: 'graduate_or_professional_only',
    },
  ],
  [
    'John Morton Blum Fellowship for Graduate Research in American History and Culture',
    {
      sourceUrl: 'https://gsas.yale.edu/john-morton-blum-fellowship-graduate-research-american-history-and-culture',
      summary: 'GSAS fellowship for PhD candidates doing dissertation research in American history and culture.',
      description:
        'The official GSAS source describes this as a fellowship for PhD candidates in History or American Studies, not undergraduate research entry.',
      bestNextStep:
        'Keep suppressed unless the product adds a graduate dissertation-research funding surface.',
      sourceKey: 'gsas:john-morton-blum-fellowship',
      suppressionReason: 'graduate_or_professional_only',
    },
  ],
  [
    'Law School Fellowships Common Application',
    {
      sourceUrl: 'https://law.yale.edu/sites/default/files/area/department/cdo/document/instructions_for_online_yls_fellowship_applications.pdf',
      summary: 'Yale Law School common application container for law-school fellowships.',
      description:
        'This is a common application container for Yale Law School fellowships. It is not a specific undergraduate research-entry program.',
      bestNextStep:
        'Keep suppressed; expose specific source-backed child programs only if the product adds a suitable surface.',
      sourceKey: 'yale-law-school:fellowships-common-application',
      suppressionReason: 'common_application_container',
    },
  ],
  [
    'Mellon Mays and Bouchet Common Application',
    {
      sourceUrl: 'https://college.yale.edu/life-at-yale/student-faculty-awards/mellon-mays-undergraduate-fellowship-program',
      summary: 'Common application container for Mellon Mays and Bouchet records.',
      description:
        'The Mellon Mays and Bouchet common application record is a container-style route. The student-facing surface should expose the specific source-backed Mellon Mays and Bouchet program records instead.',
      bestNextStep:
        'Keep suppressed and rely on specific child program records for public browse.',
      sourceKey: 'yale-college:mellon-mays-bouchet-common-application',
      suppressionReason: 'common_application_container',
    },
  ],
  [
    'Office of Fellowships Summer Projects Common Application',
    {
      sourceUrl: YALE_OFFICE_RESEARCH_FELLOWSHIPS_SOURCE_URL,
      summary: 'Office of Fellowships common application container for multiple summer project awards.',
      description:
        'This is a broad common application container rather than a specific fellowship record. Public browse should expose source-backed child fellowships instead.',
      bestNextStep:
        'Keep suppressed and rely on specific child fellowship records for public browse.',
      sourceKey: 'yale-office-of-fellowships:summer-projects-common-application',
      suppressionReason: 'common_application_container',
    },
  ],
  [
    'Office of Fellowships Summer Research Common Application',
    {
      sourceUrl: YALE_OFFICE_RESEARCH_FELLOWSHIPS_SOURCE_URL,
      summary: 'Office of Fellowships common application container for multiple summer research awards.',
      description:
        'This is a broad common application container rather than a specific fellowship record. Public browse should expose source-backed child summer research fellowships instead.',
      bestNextStep:
        'Keep suppressed and rely on specific child fellowship records for public browse.',
      sourceKey: 'yale-office-of-fellowships:summer-research-common-application',
      suppressionReason: 'common_application_container',
    },
  ],
  [
    'Parker Huang Postgraduate Fellowship',
    {
      sourceUrl: 'https://funding.yale.edu/funding-postgraduate-opportunities',
      summary: 'Yale College postgraduate fellowship route for graduating seniors.',
      description:
        'The Parker Huang Postgraduate Fellowship is a postgraduate award route. It should not appear in undergraduate research-program browse by default.',
      bestNextStep:
        'Keep suppressed unless the product adds a postgraduate fellowships surface.',
      sourceKey: 'yale-office-of-fellowships:parker-huang-postgraduate-fellowship',
      suppressionReason: 'postgraduate_award',
    },
  ],
  [
    'Robert C. Bates Postgraduate Fellowship',
    {
      sourceUrl: 'https://funding.yale.edu/funding-postgraduate-opportunities',
      summary: 'Yale College postgraduate fellowship route for graduating seniors.',
      description:
        'The Robert C. Bates Postgraduate Fellowship is a postgraduate project, internship, or research fellowship route. It should not appear in undergraduate research-program browse by default.',
      bestNextStep:
        'Keep suppressed unless the product adds a postgraduate fellowships surface.',
      sourceKey: 'yale-office-of-fellowships:robert-c-bates-postgraduate-fellowship',
      suppressionReason: 'postgraduate_award',
    },
  ],
  [
    'Translation Initiative Summer Fellowships for Graduate Students',
    {
      sourceUrl: 'https://macmillan.yale.edu/node/800023/grants-fellowships',
      summary: 'Translation Studies summer fellowship for graduate students.',
      description:
        'The official source describes this as a summer fellowship for graduate students, not undergraduate research entry.',
      bestNextStep:
        'Keep suppressed unless the product adds a graduate fellowship surface.',
      sourceKey: 'translation-initiative:summer-fellowships-graduate-students',
      suppressionReason: 'graduate_or_professional_only',
    },
  ],
  [
    'Yale College Postgraduate Fellowships Common Application',
    {
      sourceUrl: 'https://funding.yale.edu/funding-postgraduate-opportunities',
      summary: 'Common application container for Yale College postgraduate fellowships.',
      description:
        'This is a common application container for postgraduate fellowships. It is not a specific undergraduate research-entry program.',
      bestNextStep:
        'Keep suppressed unless the product adds a postgraduate fellowships surface.',
      sourceKey: 'yale-office-of-fellowships:postgraduate-fellowships-common-application',
      suppressionReason: 'common_application_container',
    },
  ],
  [
    'Yale University Art Gallery and Yale Center for British Art Graduate Research Assistantships',
    {
      sourceUrl: 'https://english.yale.edu/graduate/research-resources',
      summary: 'Graduate research assistantship route for doctoral students.',
      description:
        'The official English Department source describes these museum research assistantships as graduate research resources, not undergraduate research entry.',
      bestNextStep:
        'Keep suppressed unless the product adds a graduate assistantship surface.',
      sourceKey: 'yale-english:yuag-ycba-graduate-research-assistantships',
      suppressionReason: 'graduate_or_professional_only',
    },
  ],
]);

function firstOfficialYaleLinkedUrl(program: any): string {
  const urls = [
    program.applicationLink,
    ...(Array.isArray(program.links) ? program.links.map((link: any) => link?.url) : []),
  ];
  return urls.find(isOfficialProgramSourceUrl) || '';
}

function cleanLinks(program: any, fromTitle: string, toTitle: string) {
  if (!Array.isArray(program.links)) return undefined;
  return program.links.map((link: any) => ({
    ...link,
    label: link?.label === fromTitle ? toTitle : link?.label,
  }));
}

async function planProgramRepairs(): Promise<PlannedProgramRepair[]> {
  const programs = await Fellowship.find({ archived: false }).sort({ title: 1 }).lean();
  const repairs: PlannedProgramRepair[] = [];

  for (const program of programs as any[]) {
    const title = String(program.title || '');

    if (title === 'ale College Dean’s Research Fellowship') {
      const repairedTitle = 'Yale College Dean’s Research Fellowship';
      addRepairIfChanged(
        repairs,
        program,
        'repair_public_program_title_and_summary',
        {
          title: repairedTitle,
          summary:
            'Summer research funding for Yale College juniors preparing a senior project or thesis with a faculty adviser.',
          description:
            'The Yale College Dean’s Research Fellowship supports eligible Yale College juniors pursuing summer research that can lead into a senior project or thesis. Students should use this after they have a research plan and adviser context.',
          bestNextStep:
            'Review the official fellowship page, confirm eligibility, and prepare the application around a specific research plan and adviser.',
          sourceKey: `yale-college-fellowships-office:${slugifyKeyPart(repairedTitle)}`,
          links: cleanLinks(program, title, repairedTitle),
        },
      );
      continue;
    }

    if (title === 'AAMC Summer Undergraduate Research Programs') {
      addRepairIfChanged(
        repairs,
        program,
        'classify_external_curated_resource',
        {
          programKind: 'OTHER',
          entryMode: 'TRACK_NEXT_CYCLE',
          studentFacingCategory: 'External research directory',
          summary:
            'External AAMC directory of summer medical research programs for undergraduates; use it as a lead list, not a Yale-run fellowship.',
          description:
            'Yale links to the AAMC Summer Undergraduate Research Programs directory as an external funding and research-opportunity resource. It is useful for students exploring medical research programs outside Yale, but it should not be presented as a Yale-administered program.',
          bestNextStep:
            'Open the AAMC directory, identify programs that fit your interests, and verify each external program’s eligibility and deadline.',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'Augusta HAZARD Fund') {
      const officialUrl = firstOfficialYaleLinkedUrl(program);
      addRepairIfChanged(
        repairs,
        program,
        'suppress_graduate_only_program',
        {
          ...(officialUrl ? { sourceUrl: officialUrl } : {}),
          undergraduateOnly: false,
          studentFacingCategory: 'Archive / review',
          studentVisibilityOverrideTier: 'suppressed',
          studentVisibilitySuppressionReason: 'graduate_or_professional_only',
        },
      );
      continue;
    }

    if (title === '0 (engineering, computer science /computer engineering) research internships subjects') {
      const repairedTitle = 'Yale-UC Louvain Summer Research Program';
      addRepairIfChanged(
        repairs,
        program,
        'repair_yale_uc_louvain_program',
        {
          title: repairedTitle,
          sourceUrl: 'https://science.yalecollege.yale.edu/stem-fellowships/non-yale-research-opportunities',
          programCategory: 'SUMMER_RESEARCH_PROGRAM',
          programKind: 'CENTER_INTERNSHIP',
          entryMode: 'APPLY_TO_PROGRAM',
          studentFacingCategory: 'External summer research program',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          programDates: 'Summer',
          summary:
            'Yale-facing summer engineering research internship route with UC Louvain labs in Belgium for eligible sophomores and juniors.',
          description:
            'The Yale-UC Louvain Summer Research Program is listed by Yale College Science & QR as a non-Yale summer research opportunity. Students review the available UC Louvain research subjects, contact relevant faculty with a cover letter and CV, and may seek Tetelman Fellowship funding if accepted.',
          bestNextStep:
            'Review the official Yale listing and UC Louvain subjects list, then contact a relevant faculty project with a concise cover letter and CV.',
          prepSteps: [
            'Official Yale listing review',
            'UC Louvain subject list',
            'Cover letter and CV',
            'Faculty project contact',
          ],
          compensationSummary: 'Funding may be pursued separately through Tetelman if accepted.',
          sourceKey: `yale-college-fellowships-office:${slugifyKeyPart(repairedTitle)}`,
          links: cleanLinks(program, title, 'UC Louvain research subjects'),
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === '70 (engineering, computer science /computer engineering) research internships subjects') {
      addRepairIfChanged(
        repairs,
        program,
        'suppress_duplicate_yale_uc_louvain_fragment',
        {
          studentFacingCategory: 'Archive / review',
          studentVisibilityOverrideTier: 'suppressed',
          studentVisibilitySuppressionReason: 'duplicate_extraction_fragment',
        },
      );
      continue;
    }

    if (title === 'STARS I Academic Year Program') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_stars_i_program',
        {
          sourceUrl:
            'https://science.yalecollege.yale.edu/stem-fellowships/funding-stem-opportunities-yale/stars/stars-i-academic-year-program',
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'STRUCTURED_PROGRAM',
          entryMode: 'APPLY_TO_PROGRAM',
          studentFacingCategory: 'STEM mentoring program',
          requiresMentorBeforeApply: false,
          mentorMatching: true,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          programDates: 'Academic Year',
          summary:
            'Yale College STARS I academic-year mentoring and support program for incoming first-year students interested in STEM.',
          description:
            'STARS I is a Yale College academic-year mentoring and support program for first-year students interested in STEM. It offers peer mentoring, advising, panels, professional development, and networking rather than a direct research placement.',
          bestNextStep:
            'Review the official STARS I page and application timing; use this as STEM research-preparation support, not a direct lab placement.',
          prepSteps: ['Official STARS I page', 'Eligibility check', 'Academic-year participation'],
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'STARS II') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_stars_ii_program',
        {
          title: 'STARS II Academic Year Program',
          sourceUrl:
            'https://science.yalecollege.yale.edu/stem-fellowships/funding-stem-opportunities-yale/stars/stars-ii-program',
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'STRUCTURED_PROGRAM',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          studentFacingCategory: 'Academic-year research program',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          compensationSummary: 'Academic-year and summer research stipend when source-confirmed',
          hoursPerWeek: 10,
          programDates: 'Academic Year and Summer',
          summary:
            'Yale College STARS II supports juniors and seniors conducting research at Yale with stipend support, advising, workshops, and research presentation expectations.',
          description:
            'STARS II is a Yale College academic-year and summer research-support program for juniors and seniors who have already worked in a Yale lab. Scholars receive structured advising, workshops, presentation expectations, and stipend support for supervised research.',
          bestNextStep:
            'Confirm prior Yale lab experience and mentor fit, then review the official STARS II application timing and requirements.',
          prepSteps: [
            'Prior Yale lab experience',
            'Faculty mentor or lab context',
            'Research proposal',
            'Official application',
          ],
          sourceKey: 'yale-college-fellowships-office:stars-ii-academic-year-program',
        },
      );
      continue;
    }

    if (title === 'Digital Ethics Center Director\'s Fellows Program - Spring 2026') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_dec_directors_fellows_program',
        {
          sourceUrl: 'https://dec.yale.edu/programs/directors-fellows',
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'STRUCTURED_PROGRAM',
          entryMode: 'APPLY_TO_PROGRAM',
          studentFacingCategory: 'Semester research fellowship',
          requiresMentorBeforeApply: false,
          mentorMatching: true,
          undergraduateOnly: true,
          yaleCollegeOnly: false,
          compensationSummary: 'Semester award when source-confirmed',
          hoursPerWeek: 8,
          programDates: 'Spring 2026',
          summary:
            'Digital Ethics Center semester fellowship for Yale students researching digital ethics and AI governance, with a Junior Director\'s Fellow track for undergraduates.',
          description:
            'The Digital Ethics Center Director\'s Fellows program supports Yale students who complete a semester-long research project on digital ethics or AI governance, participate in cohort meetings, and receive a semester award. The Junior Director\'s Fellow track is for Yale undergraduates; the Senior Director\'s Fellow track is for graduate and professional students.',
          bestNextStep:
            'Review the official DEC Director\'s Fellows page, choose the Junior or Senior track, and prepare the required cover letter, CV, and research proposal.',
          prepSteps: [
            'Official DEC fellowship page',
            'Track selection',
            'Cover letter',
            'CV',
            'Research proposal',
          ],
          sourceKey: 'digital-ethics-center:directors-fellows-spring-2026',
        },
      );
      continue;
    }

    if (title === 'Edward A. Bouchet Undergraduate Fellowship') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_bouchet_undergraduate_fellowship',
        {
          sourceUrl:
            'https://college.yale.edu/life-at-yale/student-faculty-awards/edward-a-bouchet-undergraduate-fellows-program',
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'STRUCTURED_PROGRAM',
          entryMode: 'APPLY_TO_PROGRAM',
          studentFacingCategory: 'Undergraduate research fellowship',
          requiresMentorBeforeApply: false,
          mentorMatching: true,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          compensationSummary: 'Paid academic-year and summer research support when source-confirmed',
          programDates: 'Academic Year and Summer',
          summary:
            'Yale College undergraduate fellowship supporting rising juniors pursuing paid research projects during the academic year and full-time summer research.',
          description:
            'The Edward A. Bouchet Undergraduate Fellowship supports Yale College students who intend to pursue PhDs and academic careers. Fellows work on paid research projects during the academic year and pursue full-time research during the summers between sophomore, junior, and senior years.',
          bestNextStep:
            'Review the official Yale College Bouchet page and prepare the short application, recommendations, writing sample, and transcript by the listed deadline.',
          prepSteps: [
            'Official Yale College page',
            'Short application',
            'Two recommendations',
            'Writing sample',
            'Transcript',
          ],
          sourceKey: 'yale-college:edward-a-bouchet-undergraduate-fellowship',
        },
      );
      continue;
    }

    if (title === 'Barry M. Goldwater Scholarship') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_goldwater_external_scholarship',
        {
          sourceUrl: 'https://funding.yale.edu/find-funding/external-awards-non-yale',
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'OTHER',
          entryMode: 'APPLY_TO_PROGRAM',
          studentFacingCategory: 'External STEM scholarship',
          requiresMentorBeforeApply: false,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          compensationSummary: 'National scholarship support when awarded',
          programDates: 'Annual',
          summary:
            'National STEM scholarship for Yale sophomores and juniors preparing for research careers in mathematics, engineering, or the natural sciences.',
          description:
            'The Barry M. Goldwater Scholarship is an external national award coordinated through Yale fellowship advising for sophomores and juniors who intend to pursue research careers in STEM. It supports undergraduate study rather than placing students directly into a research home.',
          bestNextStep:
            'Review Yale Office of Fellowships guidance and the current campus deadline before preparing the nomination application.',
          prepSteps: [
            'Yale fellowship guidance',
            'Campus deadline check',
            'Nomination application',
            'Research-career statement',
          ],
          sourceKey: 'yale-office-of-fellowships:barry-m-goldwater-scholarship',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'Beinecke Scholarship Program') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_beinecke_external_scholarship',
        {
          sourceUrl: 'https://funding.yale.edu/find-funding/external-awards-non-yale',
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'OTHER',
          entryMode: 'APPLY_TO_PROGRAM',
          studentFacingCategory: 'External graduate-study scholarship',
          requiresMentorBeforeApply: false,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          compensationSummary: 'Graduate-study scholarship support when awarded',
          programDates: 'Annual',
          summary:
            'External scholarship for Yale juniors seeking future graduate study in research-focused arts, humanities, or social-science programs.',
          description:
            'The Beinecke Scholarship is an external national scholarship coordinated through Yale fellowship advising. It supports future graduate study for juniors with need-based financial aid who are aiming toward research-focused programs in the arts, humanities, or social sciences; it is not a direct Yale research placement.',
          bestNextStep:
            'Review Yale Office of Fellowships guidance and the current campus deadline before preparing the campus application.',
          prepSteps: [
            'Yale fellowship guidance',
            'Eligibility check',
            'Campus deadline check',
            'Graduate-study plan',
          ],
          sourceKey: 'yale-office-of-fellowships:beinecke-scholarship-program',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'Law, Environment and Animals Program (LEAP) Student Grant') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_leap_student_grant',
        {
          sourceUrl: 'https://law.yale.edu/animals/initiatives/leap-student-grant-program',
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'FELLOWSHIP_FUNDING',
          entryMode: 'APPLY_TO_PROGRAM',
          studentFacingCategory: 'Student research grant',
          requiresMentorBeforeApply: false,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: false,
          compensationSummary: 'Project grant funding when awarded',
          programDates: 'Academic Year and Summer',
          summary:
            'Yale Law School LEAP student grant supporting Yale student-led research and creative projects about urgent threats facing non-human animals.',
          description:
            'The Law, Environment & Animals Program Student Grant supports Yale University student-led research and creative projects during the academic year or summer. Projects should advance understanding of, draw attention to, or develop strategies addressing urgent threats facing non-human animals.',
          bestNextStep:
            'Review the official LEAP grant page, confirm the next application window, and prepare a project proposal aligned with LEAP priorities.',
          prepSteps: [
            'Official LEAP grant page',
            'Application window check',
            'Project proposal',
            'Budget',
          ],
          sourceKey: 'yale-law-school:leap-student-grant',
        },
      );
      continue;
    }

    if (title === 'Blue Center Short-term Research and Travel Award') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_blue_center_short_term_award',
        {
          sourceUrl: 'https://jackson.yale.edu/centers-initiatives/blue-center/opportunities/',
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'TRAVEL_RESEARCH_GRANT',
          entryMode: 'APPLY_TO_PROGRAM',
          studentFacingCategory: 'Student research travel award',
          requiresMentorBeforeApply: false,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: false,
          compensationSummary: '$500-$2,000 research or travel award when awarded',
          programDates: 'Fall and Spring cycles',
          summary:
            'Blue Center award for Yale undergraduate and graduate students pursuing short-term research travel or projects related to statecraft.',
          description:
            'The Blue Center Short-term Research and Travel Award supports Yale undergraduate and graduate students with short-term research travel, conference travel, or projects related to the study of statecraft. Awards are listed by the Yale Jackson School Blue Center and normally run in fall and spring cycles.',
          bestNextStep:
            'Review the Blue Center opportunities page, confirm the current deadline, and prepare a project or travel proposal tied to statecraft.',
          prepSteps: [
            'Official Blue Center page',
            'Project or travel proposal',
            'Budget',
            'Current deadline check',
          ],
          sourceKey: 'blue-center:short-term-research-and-travel-award',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'Charles Kao Fund Research Grants') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_charles_kao_research_grants',
        {
          sourceUrl: 'https://macmillan.yale.edu/eastasia/opportunities/charles-kao-fund-research-grants',
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'TRAVEL_RESEARCH_GRANT',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          studentFacingCategory: 'Student research travel grant',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: false,
          compensationSummary: 'Up to $5,000 when awarded',
          programDates: 'Summer',
          summary:
            'MacMillan Center grant for Yale College and graduate students conducting summer research in East or Southeast Asia.',
          description:
            'The Charles Kao Fund Research Grants support Yale College and Yale graduate or professional students conducting summer field research or creative projects in East and Southeast Asia, with emphasis on technology transfer and social, cultural, or political transformation.',
          bestNextStep:
            'Review the official MacMillan Center grant page, confirm regional and topic fit, and prepare a research proposal, budget, resume, transcript, and recommendation.',
          prepSteps: [
            'Official MacMillan Center page',
            'Research proposal',
            'Budget',
            'Resume and transcript',
            'Recommendation',
          ],
          sourceKey: 'macmillan-center:charles-kao-fund-research-grants',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'Fields Program') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_fields_program',
        {
          sourceUrl: 'https://cls.yale.edu/programs/fields',
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'OTHER',
          entryMode: 'APPLY_TO_PROGRAM',
          studentFacingCategory: 'Language research preparation',
          requiresMentorBeforeApply: false,
          mentorMatching: true,
          undergraduateOnly: true,
          yaleCollegeOnly: false,
          compensationSummary: 'Language-partner support when accepted',
          programDates: 'Fall and Spring cycles',
          summary:
            'Center for Language Study program for advanced discipline-specific language study that can support research, thesis, study abroad, or fieldwork preparation.',
          description:
            'The Fields Program is a Center for Language Study program for currently enrolled Yale students pursuing advanced language study in the context of an academic discipline or professional field. It can support preparation for research projects or final theses, but it is not itself a research placement.',
          bestNextStep:
            'Review the CLS Fields page and application process, then apply if discipline-specific language work would materially support your research or academic plan.',
          prepSteps: [
            'Official CLS Fields page',
            'Language-level eligibility check',
            'Discipline-specific language goals',
            'Application process review',
          ],
          sourceKey: 'center-for-language-study:fields-program',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'National Institute of Standards and Technology Summer Undergraduate Research Fellowship - NIST SURF') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_nist_surf_external_program',
        {
          sourceUrl: 'https://www.nist.gov/surf',
          applicationLink: 'https://www.nist.gov/surf',
          programCategory: 'SUMMER_RESEARCH_PROGRAM',
          programKind: 'CENTER_INTERNSHIP',
          entryMode: 'APPLY_TO_PROGRAM',
          studentFacingCategory: 'External summer research program',
          requiresMentorBeforeApply: false,
          mentorMatching: true,
          undergraduateOnly: true,
          yaleCollegeOnly: false,
          compensationSummary: 'Paid summer research fellowship when awarded',
          programDates: 'Summer',
          summary:
            'External NIST summer undergraduate research fellowship for U.S. citizen or permanent resident undergraduates in science and engineering fields.',
          description:
            'NIST SURF is an external summer undergraduate research fellowship at National Institute of Standards and Technology laboratories. It is useful for Yale students as an external research option, but students should verify the current NIST application route because the program no longer uses a Yale nomination process.',
          bestNextStep:
            'Review the official NIST SURF page and current USAJobs or NIST application instructions before preparing materials.',
          prepSteps: [
            'Official NIST SURF page',
            'Citizenship or permanent-resident eligibility check',
            'Resume',
            'Transcript',
            'Recommendation letters',
          ],
          sourceKey: 'nist:summer-undergraduate-research-fellowship',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'Schmidt Program on Artificial Intelligence, Emerging Technologies, and National Power Travel and Research Award') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_schmidt_travel_research_award',
        {
          sourceUrl: 'https://jackson.yale.edu/centers-initiatives/schmidt-program/',
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'TRAVEL_RESEARCH_GRANT',
          entryMode: 'APPLY_TO_PROGRAM',
          studentFacingCategory: 'Student research travel award',
          requiresMentorBeforeApply: false,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: false,
          compensationSummary: 'Up to $500 when awarded',
          programDates: 'Annual or program cycle',
          summary:
            'Schmidt Program student travel and research award for projects aligned with AI, emerging technologies, and national power.',
          description:
            'The Schmidt Program at Yale Jackson supports research and teaching on artificial intelligence, emerging technologies, and national power, and lists student initiatives and travel among its funding opportunities. This record should be used for projects aligned with the Schmidt Program research areas.',
          bestNextStep:
            'Review the official Schmidt Program page and current application route, then prepare a concise project or travel proposal tied to one of the program research areas.',
          prepSteps: [
            'Official Schmidt Program page',
            'Research-area fit',
            'Project or travel proposal',
            'Budget',
          ],
          sourceKey: 'jackson-schmidt-program:travel-and-research-award',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    const saybrookResearchRepair = saybrookResearchFellowshipRepairs.get(title);
    if (saybrookResearchRepair) {
      addRepairIfChanged(
        repairs,
        program,
        'repair_saybrook_research_fellowship',
        {
          sourceUrl: SAYBROOK_FELLOWSHIPS_SOURCE_URL,
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'TRAVEL_RESEARCH_GRANT',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          programDates: 'Annual',
          ...saybrookResearchRepair,
        },
      );
      continue;
    }

    if (title === 'Class of 1971 Summer Science Research Fellowship') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_class_of_1971_science_research_fellowship',
        {
          sourceUrl: 'https://branford.yale.edu/head-of-branford-college/student-project-funding',
          programCategory: 'SUMMER_RESEARCH_PROGRAM',
          programKind: 'FELLOWSHIP_FUNDING',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          studentFacingCategory: 'Residential college summer research funding',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          compensationSummary: 'Up to $5,000 when awarded',
          programDates: 'Summer',
          summary:
            'Branford College summer science research fellowship for returning students with a Yale faculty lab commitment.',
          description:
            'The Class of 1971 Summer Science Research Fellowship is a Branford College fellowship for returning Branford students, excluding current seniors. It supports at least nine weeks of full-time summer research, normally in New Haven, with a written commitment from a Yale faculty member whose lab will host the research.',
          bestNextStep:
            'Review Branford student project funding guidance, secure a Yale faculty lab commitment, and prepare the personal statement and research proposal.',
          prepSteps: [
            'Official Branford funding page',
            'Yale faculty lab commitment',
            'Personal statement',
            'Research proposal',
            'End-of-summer research summary',
          ],
          sourceKey: 'branford-college:class-of-1971-summer-science-research-fellowship',
        },
      );
      continue;
    }

    if (title === 'Gary Stein Fellowship') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_gary_stein_fellowship',
        {
          sourceUrl: 'https://ezrastiles.yale.edu/resources/fellowships',
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'FELLOWSHIP_FUNDING',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          studentFacingCategory: 'Residential college summer research funding',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          compensationSummary: 'Up to $1,000 when awarded',
          programDates: 'Summer',
          summary:
            'Ezra Stiles summer fellowship for a Yale undergraduate independent research project with practical scientific, social, or educational effects.',
          description:
            'The Gary Stein Fellowship is administered through Ezra Stiles College and supports a Yale undergraduate independent summer research project aimed at practical scientific, social, or educational effects. It is useful after the student has a concrete project and adviser or sponsor context.',
          bestNextStep:
            'Review the Ezra Stiles fellowships page, confirm the current deadline, and prepare an independent summer research proposal through the Student Grants Database.',
          prepSteps: [
            'Official Ezra Stiles fellowships page',
            'Independent research proposal',
            'Faculty adviser or sponsor context',
            'Budget',
            'Student Grants Database application',
          ],
          sourceKey: 'ezra-stiles-college:gary-stein-fellowship',
        },
      );
      continue;
    }

    if (title === 'Michael COE Summer Fieldwork Fund') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_michael_coe_fieldwork_fund',
        {
          sourceUrl: ARCHAEOLOGY_OPPORTUNITIES_SOURCE_URL,
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'TRAVEL_RESEARCH_GRANT',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          studentFacingCategory: 'Archaeology fieldwork funding',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: false,
          compensationSummary: 'Fieldwork travel support when awarded',
          programDates: 'Summer',
          summary:
            'Council on Archaeological Studies fieldwork funding primarily for undergraduate Archaeological Studies majors fulfilling summer fieldwork requirements.',
          description:
            'The Michael Coe Fieldwork Fund is administered by Yale Council on Archaeological Studies and is intended primarily for undergraduate Archaeological Studies majors seeking to fulfill their summer fieldwork requirement. Other students may be considered when connected to Council faculty projects.',
          bestNextStep:
            'Review the Council on Archaeological Studies opportunities page, confirm Archaeological Studies fit, and prepare the Albers-Coe-Hazard application with adviser or DUS approval.',
          prepSteps: [
            'Official Archaeological Studies opportunities page',
            'Archaeological Studies fit',
            'Fieldwork proposal',
            'Itemized budget',
            'Adviser or DUS approval',
          ],
          sourceKey: 'council-on-archaeological-studies:michael-coe-fieldwork-fund',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'Josef ALBERS Traveling Fellowship Fund') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_josef_albers_traveling_fellowship',
        {
          sourceUrl: ARCHAEOLOGY_OPPORTUNITIES_SOURCE_URL,
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'TRAVEL_RESEARCH_GRANT',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          studentFacingCategory: 'Archaeology research travel funding',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: false,
          compensationSummary: '$1,000-$5,000 typical grant range when awarded',
          programDates: 'Annual',
          summary:
            'Yale archaeology research travel fellowship for scholarly work on pre-Columbian or Colonial art and artifacts of Mesoamerica, Central America, or South America.',
          description:
            'The Josef Albers Traveling Fellowship is administered through Yale Council on Archaeological Studies for Yale students, postdoctoral appointees, and junior faculty researching pre-Columbian or Colonial art and artifacts of Mesoamerica, Central America, or South America. Because the audience is mixed, this should remain restrained for undergraduate browsing.',
          bestNextStep:
            'Review the Council on Archaeological Studies opportunities page and prepare the Albers-Coe-Hazard application only if the project fits the required region, period, and adviser context.',
          prepSteps: [
            'Official Archaeological Studies opportunities page',
            'Region and period fit',
            'Research travel proposal',
            'Itemized budget',
            'Adviser or DUS approval',
          ],
          sourceKey: 'council-on-archaeological-studies:josef-albers-traveling-fellowship',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (
      title ===
        'Council on Latin American and Iberian Studies (CLAIS) - Fall Semester, Winter Break, and Spring Semester Travel/Conference Award' ||
      title ===
        'European Studies Council - Fall Semester, Winter Break, and Spring Semester Travel/Conference Award'
    ) {
      const isClais = title.startsWith('Council on Latin American');
      addRepairIfChanged(
        repairs,
        program,
        isClais ? 'repair_clais_travel_conference_award' : 'repair_esc_travel_conference_award',
        {
          sourceUrl: MACMILLAN_FELLOWSHIPS_SOURCE_URL,
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'TRAVEL_RESEARCH_GRANT',
          entryMode: 'APPLY_TO_PROGRAM',
          studentFacingCategory: 'Research and conference travel funding',
          requiresMentorBeforeApply: false,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: false,
          compensationSummary: 'Up to $500 supplemental travel award when awarded',
          programDates: 'Fall, Winter, and Spring cycles',
          summary: isClais
            ? 'MacMillan Center CLAIS supplemental travel award for Yale undergraduate, graduate, and professional students doing short-term Latin America, Spain, or Portugal research or conference travel.'
            : 'MacMillan Center European Studies supplemental travel award for Yale undergraduate, graduate, and professional students doing Europe, Russia, or Eurasia research or conference travel.',
          description: isClais
            ? 'The Council on Latin American and Iberian Studies travel/conference award is listed by the MacMillan Center for Yale undergraduate, graduate, and professional students. It helps defray short-term research or conference travel costs related to Latin America, Spain, or Portugal during the academic year.'
            : 'The European Studies Council travel/conference award is listed by the MacMillan Center for Yale undergraduate, graduate, and professional students. It helps defray short-term research or conference travel costs related to Europe, Russia, or Eurasia during the academic year.',
          bestNextStep:
            'Review the MacMillan fellowships page, confirm council eligibility and travel window, and prepare a project description, budget, and recommendation if required.',
          prepSteps: [
            'Official MacMillan fellowships page',
            'Council eligibility check',
            'Travel or conference plan',
            'Budget',
            'Recommendation if required',
          ],
          sourceKey: isClais
            ? 'macmillan-center:clais-travel-conference-award'
            : 'macmillan-center:european-studies-travel-conference-award',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'Daniel Merriman - Ted Bensinger III Fellowship for Juniors') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_daniel_merriman_ted_bensinger_fellowship',
        {
          sourceUrl: DAVENPORT_FELLOWSHIPS_SOURCE_URL,
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'FELLOWSHIP_FUNDING',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          studentFacingCategory: 'Residential college summer funding',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          compensationSummary: 'Residential-college fellowship funding when awarded',
          programDates: 'Summer',
          summary:
            'Davenport College fellowship route for junior-year summer work, including projects that need source-backed adviser or sponsor context.',
          description:
            'The Daniel Merriman - Ted Bensinger III Fellowship for Juniors is listed by Davenport College among its fellowship and award options. It should be presented as residential-college funding that may support a concrete summer plan, not as a general Yale-wide research placement.',
          bestNextStep:
            'Review the Davenport fellowships page, confirm current eligibility and deadline, and prepare the Student Grants Database application around a specific project and adviser or sponsor context.',
          prepSteps: [
            'Official Davenport fellowships page',
            'Davenport eligibility check',
            'Project or research plan',
            'Adviser or sponsor context',
            'Student Grants Database application',
          ],
          sourceKey: 'davenport-college:daniel-merriman-ted-bensinger-fellowship',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'Howard Topol Travel Fellowships') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_howard_topol_travel_fellowships',
        {
          sourceUrl: SILLIMAN_FELLOWSHIPS_SOURCE_URL,
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'TRAVEL_RESEARCH_GRANT',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          studentFacingCategory: 'Residential college travel funding',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          compensationSummary: 'Residential-college travel fellowship funding when awarded',
          programDates: 'Summer',
          summary:
            'Silliman College travel fellowship route for students with a concrete summer project or research plan.',
          description:
            'The Howard Topol Travel Fellowships are listed by Silliman College among its fellowship options. Because the source supports residential-college travel funding rather than a direct research placement, this record should stay restrained until a richer program page is attached.',
          bestNextStep:
            'Review the Silliman fellowships page, confirm the current title, eligibility, and deadline, then prepare a specific travel or research proposal.',
          prepSteps: [
            'Official Silliman fellowships page',
            'Silliman eligibility check',
            'Travel or research proposal',
            'Budget',
            'Student Grants Database application',
          ],
          sourceKey: 'silliman-college:howard-topol-travel-fellowships',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'Harvey Geiger Fellowships in Architecture') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_harvey_geiger_architecture_fellowship',
        {
          sourceUrl: HARVEY_GEIGER_ARCHITECTURE_SOURCE_URL,
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'TRAVEL_RESEARCH_GRANT',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          studentFacingCategory: 'Architecture research travel funding',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          compensationSummary: 'Architecture travel and research funding when awarded',
          programDates: 'Summer or research travel cycle',
          summary:
            'Yale Architecture-linked travel and research fellowship for Yale College architecture students with a source-backed project plan.',
          description:
            'The Harvey Geiger Fellowship supports undergraduate travel and research in architecture contexts. The available Yale source confirms undergraduate architecture research travel use, but this row should stay restrained until a current standing program page is attached.',
          bestNextStep:
            'Use this after identifying an architecture research question, travel plan, and faculty or department context; verify the current application details in the Student Grants Database.',
          prepSteps: [
            'Yale source review',
            'Architecture project or research plan',
            'Travel plan',
            'Faculty or department context',
            'Student Grants Database application',
          ],
          sourceKey: 'yale-architecture:harvey-geiger-fellowship',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'James A. Helzer Travel Fund') {
      const officialUrl = firstOfficialYaleLinkedUrl(program);
      addRepairIfChanged(
        repairs,
        program,
        'repair_james_helzer_travel_fund',
        {
          ...(officialUrl ? { sourceUrl: officialUrl } : {}),
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'TRAVEL_RESEARCH_GRANT',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          studentFacingCategory: 'Residential college academic travel funding',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          compensationSummary: 'Up to $500 during term-time when awarded',
          programDates: 'Academic year',
          summary:
            'Silliman College term-time travel fund for academic pursuits, research, or Yale-affiliated academic club activity.',
          description:
            'The James A. Helzer Travel Fund supports Silliman College students with term-time academic travel, including research-related travel when validated by appropriate academic context. Because the current source is an application-detail route rather than a richer standing program page, this should remain restrained.',
          bestNextStep:
            'Confirm Silliman eligibility, DUS or department validation if needed, and current term-time application requirements in the Student Grants Database.',
          prepSteps: [
            'Silliman eligibility check',
            'Academic or research travel plan',
            'DUS or department validation when required',
            'Registration or travel proof',
            'Student Grants Database application',
          ],
          sourceKey: 'silliman-college:james-a-helzer-travel-fund',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'NSF-REU Infectious Disease Computational Insights') {
      const repairedTitle =
        'NSF Research Experience for Undergraduates (REU) Computational Analysis of Infectious Diseases';
      addRepairIfChanged(
        repairs,
        program,
        'repair_nsf_reu_computational_infectious_diseases',
        {
          title: repairedTitle,
          sourceUrl: NSF_REU_COMPUTATIONAL_INFECTIOUS_DISEASES_SOURCE_URL,
          programCategory: 'SUMMER_RESEARCH_PROGRAM',
          programKind: 'STRUCTURED_PROGRAM',
          entryMode: 'APPLY_TO_PROGRAM',
          studentFacingCategory: 'Structured summer research program',
          requiresMentorBeforeApply: false,
          mentorMatching: true,
          undergraduateOnly: true,
          yaleCollegeOnly: false,
          compensationSummary: 'Summer stipend, housing, and meal support when awarded',
          programDates: 'Summer; applications open December 1, 2025 and close March 1, 2026',
          applicationOpenDate: new Date('2025-12-01T05:00:00.000Z'),
          deadline: new Date('2026-03-01T05:00:00.000Z'),
          summary:
            'Yale-hosted NSF REU summer research program in computational analysis of infectious diseases for eligible undergraduates, including formerly incarcerated and community-college students.',
          description:
            'The NSF Research Experience for Undergraduates (REU) Computational Analysis of Infectious Diseases is a Yale-hosted structured summer research program. It focuses on computational analysis and public health, with eligibility and application details confirmed by the official Yale College page.',
          bestNextStep:
            'Review the Yale College program page, confirm eligibility and the next application window, then apply through the linked Yale Student Grants Database route when the cycle opens.',
          prepSteps: [
            'Official Yale College program page',
            'Eligibility check',
            'Computational analysis or public-health interest',
            'Application materials',
            'Student Grants Database application',
          ],
          sourceKey: 'yale-college:nsf-reu-computational-analysis-infectious-diseases',
          links: cleanLinks(program, title, repairedTitle),
          studentVisibilityOverrideTier: 'student_ready',
        },
      );
      continue;
    }

    if (title.startsWith('Advising Fellowship Programs advisers are available')) {
      addRepairIfChanged(
        repairs,
        program,
        'suppress_fellowships_advising_homepage_snippet',
        {
          sourceUrl: 'https://funding.yale.edu/',
          programKind: 'OTHER',
          entryMode: 'TRACK_NEXT_CYCLE',
          studentFacingCategory: 'Archive / review',
          requiresMentorBeforeApply: false,
          mentorMatching: false,
          undergraduateOnly: false,
          yaleCollegeOnly: false,
          summary:
            'Yale fellowship-advising homepage snippet retained for operator cleanup, not a standalone student program.',
          description:
            'This row is advising/navigation copy from the Yale Fellowships and Funding site. It does not describe a distinct undergraduate research program, funding award, or entry pathway.',
          bestNextStep:
            'Suppress this record and rely on specific source-backed fellowship or program records instead.',
          sourceKey: 'yale-fellowships-and-funding:advising-homepage-snippet',
          studentVisibilityOverrideTier: 'suppressed',
          studentVisibilitySuppressionReason: 'admin_or_advising_page',
        },
      );
      continue;
    }

    if (title === 'George J. Schulz Summer Fellowship in the Physical Sciences') {
      const officialUrl = firstOfficialYaleLinkedUrl(program);
      addRepairIfChanged(
        repairs,
        program,
        'repair_george_schulz_physical_sciences_fellowship',
        {
          ...(officialUrl ? { sourceUrl: officialUrl } : {}),
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'FELLOWSHIP_FUNDING',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          studentFacingCategory: 'Residential college summer research funding',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          programDates: 'Summer',
          summary:
            'Silliman College summer fellowship supporting physical-sciences research for eligible undergraduate students.',
          description:
            'The George J. Schulz Summer Fellowship in the Physical Sciences is a source-backed residential college summer research funding record. Keep copy restrained because the current source evidence is application-detail oriented rather than a rich standing program page.',
          bestNextStep:
            'Confirm Silliman eligibility and current Student Grants Database instructions before preparing a research plan and mentor context.',
          prepSteps: [
            'Silliman eligibility check',
            'Physical-sciences research plan',
            'Faculty or lab mentor context',
            'Student Grants Database application',
          ],
          sourceKey: 'silliman-college:george-j-schulz-summer-fellowship-physical-sciences',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'Henry Hart Rice Foreign Residence Fellowship') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_henry_hart_rice_foreign_residence_fellowship',
        {
          sourceUrl: MACMILLAN_HENRY_HART_RICE_SOURCE_URL,
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'TRAVEL_RESEARCH_GRANT',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          studentFacingCategory: 'International research or project funding',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: false,
          yaleCollegeOnly: false,
          programDates: 'Summer or approved international residence period',
          summary:
            'MacMillan-linked foreign residence fellowship for approved international work, research, or independent study.',
          description:
            'The Henry Hart Rice Foreign Residence Fellowship is useful as a funding/formalization route once a student has a credible international project plan. It is not itself a research-home entry pathway, so public copy should stay restrained.',
          bestNextStep:
            'Review the MacMillan source, confirm eligibility, and prepare a source-backed project plan with adviser or program context before applying.',
          prepSteps: ['MacMillan source review', 'Eligibility check', 'Project plan', 'Adviser context'],
          sourceKey: 'macmillan-center:henry-hart-rice-foreign-residence-fellowship',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'Herbert Scarf Summer Research Opportunities in Economics') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_herbert_scarf_economics_summer_research',
        {
          sourceUrl: ECONOMICS_HERBERT_SCARF_SOURCE_URL,
          programCategory: 'SUMMER_RESEARCH_PROGRAM',
          programKind: 'MENTOR_MATCHING',
          entryMode: 'DIRECT_FACULTY_MATCHING',
          studentFacingCategory: 'Faculty-mentored summer research program',
          requiresMentorBeforeApply: false,
          mentorMatching: true,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          programDates: 'Summer; recurring cycle should be verified annually',
          summary:
            'Yale Economics summer research opportunities that match undergraduate students with faculty research projects.',
          description:
            'The Herbert Scarf Summer Research Opportunities in Economics are source-backed Yale Economics summer research placements. The known source documents a current/recurring project list and faculty-mentored research structure, but operators should refresh cycle dates each year.',
          bestNextStep:
            'Review the Yale Economics project list and application cycle, then apply through the department route when the next cycle opens.',
          prepSteps: ['Yale Economics source review', 'Project fit', 'Economics background', 'Application materials'],
          sourceKey: 'yale-economics:herbert-scarf-summer-research-opportunities',
          studentVisibilityOverrideTier: 'student_ready',
        },
      );
      continue;
    }

    if (title === 'John E. Linck and Alanne Headland Linck Fellowship') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_linck_fellowship',
        {
          sourceUrl: EZRA_STILES_AWARDS_SOURCE_URL,
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'FELLOWSHIP_FUNDING',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          studentFacingCategory: 'Residential college project or research funding',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          programDates: 'Summer or award cycle',
          summary:
            'Ezra Stiles-linked fellowship supporting student projects, internships, service, or research for the greater good.',
          description:
            'The John E. Linck and Alanne Headland Linck Fellowship is a source-backed residential college award. It can support research-adjacent student work, but it should not be described as a research placement or research home.',
          bestNextStep:
            'Confirm residential college eligibility and prepare a project, internship, service, or research plan before applying.',
          prepSteps: ['Ezra Stiles source review', 'Eligibility check', 'Project plan', 'Budget or application materials'],
          sourceKey: 'ezra-stiles-college:john-e-linck-alanne-headland-linck-fellowship',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === "Gruber Fellowships in Global Justice and Women's Rights") {
      addRepairIfChanged(
        repairs,
        program,
        'suppress_gruber_graduate_professional_fellowship',
        {
          sourceUrl: GRUBER_FELLOWSHIPS_SOURCE_URL,
          programKind: 'OTHER',
          entryMode: 'TRACK_NEXT_CYCLE',
          studentFacingCategory: 'Archive / review',
          requiresMentorBeforeApply: false,
          mentorMatching: false,
          undergraduateOnly: false,
          yaleCollegeOnly: false,
          summary:
            'Yale Law School Gruber fellowship route for graduate/professional students or recent alumni, not a Yale College undergraduate research program.',
          description:
            'The Gruber Fellowships are source-backed but do not belong in undergraduate research discovery because the official audience is graduate/professional or recent alumni rather than current Yale College students seeking research homes.',
          bestNextStep:
            'Keep suppressed unless the product adds a separate graduate/professional fellowship surface.',
          sourceKey: 'yale-law-school:gruber-fellowships-global-justice-womens-rights',
          studentVisibilityOverrideTier: 'suppressed',
          studentVisibilitySuppressionReason: 'graduate_or_professional_or_alumni_only',
        },
      );
      continue;
    }

    if (title === 'Program in Grand Strategy Fellowships') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_grand_strategy_fellowships',
        {
          sourceUrl: GRAND_STRATEGY_SOURCE_URL,
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'FELLOWSHIP_FUNDING',
          entryMode: 'APPLY_TO_PROGRAM',
          studentFacingCategory: 'Grand Strategy research funding',
          requiresMentorBeforeApply: false,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: false,
          programDates: 'Summer or program cycle',
          summary:
            'Jackson School Grand Strategy-linked fellowship or summer research funding route for students in the program ecosystem.',
          description:
            'The Program in Grand Strategy fellowship record is source-backed but broad. Treat it as a restrained program/funding route until a more specific current fellowship page is attached.',
          bestNextStep:
            'Review the Jackson Grand Strategy source and current program eligibility before preparing an application or research proposal.',
          prepSteps: ['Grand Strategy source review', 'Eligibility check', 'Research or policy project fit'],
          sourceKey: 'jackson-school:program-in-grand-strategy-fellowships',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'REEESNe Student Internship and Research Grant') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_reeesne_student_internship_research_grant',
        {
          sourceUrl: REEESNE_SMALL_GRANTS_SOURCE_URL,
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'TRAVEL_RESEARCH_GRANT',
          entryMode: 'APPLY_TO_PROGRAM',
          studentFacingCategory: 'Internship and research grant',
          requiresMentorBeforeApply: false,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: false,
          programDates: 'Summer or posted grant cycle',
          summary:
            'REEESNe small grant supporting eligible student internships or research connected to Russian, East European, and Eurasian studies.',
          description:
            'The REEESNe Student Internship and Research Grant has a strong official Yale source, clear student audience, and source-backed internship/research use. It is safe to show prominently when current cycle details are present.',
          bestNextStep:
            'Review the REEESNe small grants page, confirm eligibility and deadlines, then prepare the internship or research proposal.',
          prepSteps: ['REEESNe source review', 'Eligibility check', 'Internship or research proposal', 'Application materials'],
          sourceKey: 'macmillan-reeesne:student-internship-and-research-grant',
          studentVisibilityOverrideTier: 'student_ready',
        },
      );
      continue;
    }

    if (title === 'South Asian Studies Council Grants for Language Study') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_south_asian_studies_language_grant',
        {
          sourceUrl: YALE_OFFICE_FELLOWSHIPS_SOURCE_URL,
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'OTHER',
          entryMode: 'APPLY_TO_PROGRAM',
          studentFacingCategory: 'Language study funding',
          requiresMentorBeforeApply: false,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: false,
          programDates: 'Summer or language-study cycle',
          summary:
            'Yale-linked South Asian Studies Council funding for language study, retained as adjacent preparation rather than research-home entry.',
          description:
            'This record is useful for students whose research preparation requires language study, but the source-backed activity is language study rather than a research placement or research home.',
          bestNextStep:
            'Use this only when language study is part of a broader research plan; verify eligibility and current application details first.',
          prepSteps: ['Official source review', 'Language-study plan', 'Research-preparation rationale', 'Application materials'],
          sourceKey: 'yale-office-of-fellowships:south-asian-studies-council-language-study-grants',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'Summer Fellowship in Japan') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_summer_fellowship_in_japan',
        {
          sourceUrl: CEAS_CIPE_SOURCE_URL,
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'TRAVEL_RESEARCH_GRANT',
          entryMode: 'APPLY_TO_PROGRAM',
          studentFacingCategory: 'Japan summer research or project funding',
          requiresMentorBeforeApply: false,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          compensationSummary: 'Up to $7,000 when awarded',
          programDates: 'Summer',
          summary:
            'CEAS/CIPE-linked summer fellowship supporting eligible Yale College projects, internships, or research in Japan.',
          description:
            'The Summer Fellowship in Japan has a Yale source and a clear undergraduate-facing summer use case, including research or project work when source-confirmed. It should be shown as funding/project support rather than a research home.',
          bestNextStep:
            'Review CEAS/CIPE eligibility and prepare a Japan-focused project, internship, or research proposal before applying.',
          prepSteps: ['CEAS/CIPE source review', 'Japan-focused plan', 'Eligibility check', 'Application materials'],
          sourceKey: 'macmillan-ceas:summer-fellowship-in-japan',
          studentVisibilityOverrideTier: 'student_ready',
        },
      );
      continue;
    }

    if (title === 'Summer Journalism Fellowships: Shana Alexander') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_shana_alexander_journalism_fellowship',
        {
          title: 'Shana Alexander Journalism/Media Fellowship',
          sourceUrl: YALE_OFFICE_FELLOWSHIPS_SOURCE_URL,
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'FELLOWSHIP_FUNDING',
          entryMode: 'APPLY_TO_PROGRAM',
          studentFacingCategory: 'Journalism or media project funding',
          requiresMentorBeforeApply: false,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          programDates: 'Summer or award cycle',
          summary:
            'Yale Office of Fellowships-listed funding for journalism or media work, including source-backed summer project use.',
          description:
            'The Shana Alexander Journalism/Media Fellowship is source-backed but not a research-home entry pathway. Keep public copy restrained and frame it as journalism/media project funding.',
          bestNextStep:
            'Review Yale Office of Fellowships guidance and prepare a journalism or media project plan before applying.',
          prepSteps: ['Yale Office of Fellowships source review', 'Project plan', 'Work samples or proposal', 'Application materials'],
          sourceKey: 'yale-office-of-fellowships:shana-alexander-journalism-media-fellowship',
          links: cleanLinks(program, title, 'Shana Alexander Journalism/Media Fellowship'),
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'William and Miriam Horowitz and David and Iris Fischer Judaica Project Funds') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_horowitz_fischer_judaica_project_funds',
        {
          sourceUrl: SCHELL_HUMAN_RIGHTS_CAMPUS_SOURCE_URL,
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'FELLOWSHIP_FUNDING',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          studentFacingCategory: 'Judaica project funding',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: false,
          programDates: 'Summer or project cycle',
          summary:
            'Yale-linked project funds for work increasing understanding of Jewish history, culture, or religious thought.',
          description:
            'The Horowitz/Fischer Judaica project funds are source-backed as project funding rather than a research home. Keep public copy restrained until a direct current award page is attached.',
          bestNextStep:
            'Confirm eligibility and source details, then prepare a Judaica-focused project plan with adviser or program context.',
          prepSteps: ['Official source review', 'Judaica project plan', 'Adviser or program context', 'Application materials'],
          sourceKey: 'yale-human-rights-campus:horowitz-fischer-judaica-project-funds',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'YSE Supplementary Fund') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_yse_supplementary_fund',
        {
          sourceUrl: YSE_SUMMER_FUNDING_SOURCE_URL,
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'FELLOWSHIP_FUNDING',
          entryMode: 'APPLY_TO_PROGRAM',
          studentFacingCategory: 'YSE summer experience funding',
          requiresMentorBeforeApply: false,
          mentorMatching: false,
          undergraduateOnly: false,
          yaleCollegeOnly: false,
          programDates: 'Summer; source lists April 3, 2026 deadline for the known cycle',
          summary:
            'Yale School of the Environment supplementary funding for eligible YSE students completing required summer experiences.',
          description:
            'The YSE Supplementary Fund is source-backed but narrow to Yale School of the Environment students and should not be presented as a Yale College research pathway.',
          bestNextStep:
            'Only use this record for YSE-student summer experience planning; verify the current YSE source and deadline before applying.',
          prepSteps: ['YSE eligibility check', 'Summer experience plan', 'Current deadline review', 'Application materials'],
          sourceKey: 'yse:summer-experience-supplementary-fund',
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    if (title === 'Fox International Fellowships Application for Outgoing Yale Students') {
      addRepairIfChanged(
        repairs,
        program,
        'suppress_postgraduate_exchange_common_application',
        {
          sourceUrl: MACMILLAN_EUROPE_FELLOWSHIPS_SOURCE_URL,
          undergraduateOnly: false,
          yaleCollegeOnly: false,
          studentFacingCategory: 'Archive / review',
          summary:
            'MacMillan Center international fellowship application route retained for operator review, not undergraduate research-home discovery.',
          description:
            'The Fox International Fellowship is a broader international exchange fellowship route rather than a Yale undergraduate research-home or program surface. Keep this common-application style record out of student browse unless a separate undergraduate research-facing child record is created.',
          bestNextStep:
            'Operators should verify whether a separate undergraduate research-facing child record is needed before exposing this program.',
          sourceKey: 'macmillan-center:fox-international-fellowship-outgoing-yale-students',
          studentVisibilityOverrideTier: 'suppressed',
          studentVisibilitySuppressionReason: 'postgraduate_or_exchange_common_application',
        },
      );
      continue;
    }

    if (title === 'Fulbright Grants for Graduating Seniors') {
      addRepairIfChanged(
        repairs,
        program,
        'suppress_external_postgraduate_award',
        {
          sourceUrl: YALE_EXTERNAL_AWARDS_SOURCE_URL,
          undergraduateOnly: false,
          yaleCollegeOnly: false,
          studentFacingCategory: 'Archive / review',
          summary:
            'External postgraduate award route coordinated through Yale fellowship advising, not an undergraduate research-home program.',
          description:
            'Fulbright grants for graduating seniors are external postgraduate awards. They may be valuable fellowship-advising content, but they should not appear in undergraduate research discovery alongside research homes, undergraduate research funding, or mentor-matching programs.',
          bestNextStep:
            'Keep this in operator review or a separate external-awards surface unless product scope expands beyond undergraduate research discovery.',
          sourceKey: 'yale-office-of-fellowships:fulbright-grants-for-graduating-seniors',
          studentVisibilityOverrideTier: 'suppressed',
          studentVisibilitySuppressionReason: 'postgraduate_or_external_award',
        },
      );
      continue;
    }

    if (title === 'Mellon/Kings Common Application') {
      const officialUrl = firstOfficialYaleLinkedUrl(program);
      addRepairIfChanged(
        repairs,
        program,
        'suppress_common_application_container',
        {
          ...(officialUrl ? { sourceUrl: officialUrl } : {}),
          undergraduateOnly: false,
          yaleCollegeOnly: false,
          studentFacingCategory: 'Archive / review',
          summary:
            'Common application container retained for operator cleanup, not a standalone undergraduate research program.',
          description:
            'The Mellon/Kings common application record is a container-style fellowship application route. It is not specific enough to show as a student-facing undergraduate research opportunity without separate source-backed child records.',
          bestNextStep:
            'Operators should split source-backed child opportunities when they are in undergraduate research scope, then keep the common-application container hidden.',
          sourceKey: 'student-grants-database:mellon-kings-common-application',
          studentVisibilityOverrideTier: 'suppressed',
          studentVisibilitySuppressionReason: 'common_application_container',
        },
      );
      continue;
    }

    if (title === 'Projects for Peace Alumni Award - Davis Foundation') {
      const officialUrl = firstOfficialYaleLinkedUrl(program);
      addRepairIfChanged(
        repairs,
        program,
        'suppress_alumni_or_prior_awardee_program',
        {
          ...(officialUrl ? { sourceUrl: officialUrl } : {}),
          undergraduateOnly: false,
          yaleCollegeOnly: false,
          studentFacingCategory: 'Archive / review',
          summary:
            'Alumni or prior-awardee route retained for operator review, not normal undergraduate research discovery.',
          description:
            'The Projects for Peace alumni award appears to be aimed at alumni or prior awardees rather than current undergraduate research discovery. Keep it hidden unless a source-backed current-student program record is created separately.',
          bestNextStep:
            'Operators should verify eligibility from an official Yale or Davis Projects for Peace source before creating any student-facing record.',
          sourceKey: 'student-grants-database:projects-for-peace-alumni-award',
          studentVisibilityOverrideTier: 'suppressed',
          studentVisibilitySuppressionReason: 'alumni_or_prior_awardee_only',
        },
      );
      continue;
    }

    if (title === 'SQR STEM Research Fellowship Phase 2 2025') {
      const officialUrl = firstOfficialYaleLinkedUrl(program);
      addRepairIfChanged(
        repairs,
        program,
        'suppress_internal_continuation_phase',
        {
          ...(officialUrl ? { sourceUrl: officialUrl } : {}),
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          studentFacingCategory: 'Archive / review',
          summary:
            'Internal continuation-phase application record retained for operator cleanup, not a standalone browse result.',
          description:
            'The SQR STEM Research Fellowship Phase 2 record appears to be a continuation or internal phase of a broader STEM fellowship workflow. It should stay hidden from student browse until the parent program and current cycle are source-backed.',
          bestNextStep:
            'Operators should attach this to the parent STEM fellowship workflow or suppress it permanently if it is only an internal application phase.',
          sourceKey: 'student-grants-database:sqr-stem-research-fellowship-phase-2-2025',
          studentVisibilityOverrideTier: 'suppressed',
          studentVisibilitySuppressionReason: 'internal_continuation_phase',
        },
      );
      continue;
    }

    if (title === 'STEM Summer Fellowships') {
      const officialUrl = firstOfficialYaleLinkedUrl(program) || STEM_FELLOWSHIPS_SOURCE_URL;
      addRepairIfChanged(
        repairs,
        program,
        'suppress_parent_container_program',
        {
          sourceUrl: officialUrl,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          studentFacingCategory: 'Archive / review',
          summary:
            'Parent/container record for Yale College STEM summer fellowships; student-facing browse should use specific child fellowship records.',
          description:
            'The STEM Summer Fellowships record is too broad to act as a standalone undergraduate research program because specific child fellowships already carry the actionable source-backed details. Keep this parent/container row hidden to avoid duplicate or vague browse results.',
          bestNextStep:
            'Expose specific source-backed child fellowship records instead of this broad parent container.',
          sourceKey: 'yale-college-stem-fellowships:stem-summer-fellowships-container',
          studentVisibilityOverrideTier: 'suppressed',
          studentVisibilitySuppressionReason: 'parent_container_program',
        },
      );
      continue;
    }

    if (title === 'Stanley B. Burns M.D. Fellowship for the Study of Medical Photographic History') {
      addRepairIfChanged(
        repairs,
        program,
        'suppress_external_researcher_library_fellowship',
        {
          sourceUrl: STANLEY_BURNS_FELLOWSHIP_SOURCE_URL,
          undergraduateOnly: false,
          yaleCollegeOnly: false,
          studentFacingCategory: 'Archive / review',
          summary:
            'Medical Historical Library fellowship for a broad researcher audience, not a Yale undergraduate research-entry program.',
          description:
            'The Stanley B. Burns M.D. Fellowship supports research in medical photographic history through Yale Library special collections. Its audience is broader than Yale undergraduates, so it should not appear in undergraduate research-program browse by default.',
          bestNextStep:
            'Keep this in archive/review unless the product adds a separate special-collections fellowships surface for broad researcher audiences.',
          sourceKey: 'yale-medical-historical-library:stanley-burns-fellowship',
          studentVisibilityOverrideTier: 'suppressed',
          studentVisibilitySuppressionReason: 'not_undergraduate_research_entry',
        },
      );
      continue;
    }

    const yaleOfficeResearchRepair = yaleOfficeResearchFellowshipRepairs.get(title);
    if (yaleOfficeResearchRepair) {
      addRepairIfChanged(
        repairs,
        program,
        'repair_yale_office_summer_research_fellowship',
        {
          sourceUrl: YALE_OFFICE_RESEARCH_FELLOWSHIPS_SOURCE_URL,
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'TRAVEL_RESEARCH_GRANT',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          compensationSummary: 'Summer fellowship funding when awarded',
          programDates: 'Summer',
          ...yaleOfficeResearchRepair,
        },
      );
      continue;
    }

    const reviewedResidentialCollegeRepair = reviewedResidentialCollegeResearchFundingRepairs.get(title);
    if (reviewedResidentialCollegeRepair) {
      addRepairIfChanged(
        repairs,
        program,
        'repair_reviewed_residential_college_research_funding',
        {
          programCategory: 'FELLOWSHIP',
          programKind: /mellon|senior/i.test(title) ? 'SENIOR_THESIS_FUNDING' : 'TRAVEL_RESEARCH_GRANT',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          compensationSummary: 'Residential college research funding when awarded',
          ...reviewedResidentialCollegeRepair,
          studentVisibilityOverrideTier: 'limited_but_safe',
        },
      );
      continue;
    }

    const reviewedAreaStudiesRepair = reviewedAreaStudiesProgramRepairs.get(title);
    if (reviewedAreaStudiesRepair) {
      addRepairIfChanged(
        repairs,
        program,
        'repair_reviewed_area_studies_research_funding',
        {
          programCategory: 'FELLOWSHIP',
          programKind: /senior essay/i.test(title) ? 'SENIOR_THESIS_FUNDING' : 'TRAVEL_RESEARCH_GRANT',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: false,
          compensationSummary: 'Area-studies research funding when awarded',
          ...reviewedAreaStudiesRepair,
          studentVisibilityOverrideTier: reviewedAreaStudiesRepair.studentVisibilityOverrideTier ?? 'limited_but_safe',
        },
      );
      continue;
    }

    const reviewedSuppression = reviewedProgramSuppressions.get(title);
    if (reviewedSuppression) {
      addRepairIfChanged(
        repairs,
        program,
        'suppress_reviewed_non_undergraduate_program',
        {
          sourceUrl: reviewedSuppression.sourceUrl,
          programCategory: 'FELLOWSHIP',
          programKind: 'OTHER',
          entryMode: 'TRACK_NEXT_CYCLE',
          undergraduateOnly: false,
          yaleCollegeOnly: false,
          studentFacingCategory: 'Archive / review',
          summary: reviewedSuppression.summary,
          description: reviewedSuppression.description,
          bestNextStep: reviewedSuppression.bestNextStep,
          prepSteps: ['Archive review', 'Official source review'],
          sourceKey: reviewedSuppression.sourceKey,
          studentVisibilityOverrideTier: 'suppressed',
          studentVisibilitySuppressionReason: reviewedSuppression.suppressionReason,
        },
      );
      continue;
    }

    if (
      title === 'Council on East Asian Studies Summer Travel and Research Grants' ||
      title === 'International Security Studies (ISS) Short-term Research and Travel Award' ||
      title === 'Lindsay Fellowship for Research in Africa' ||
      title === 'Mobley Family Environmental Humanities Summer Student Research Grants'
    ) {
      const sourceUrlByTitle: Record<string, string> = {
        'Council on East Asian Studies Summer Travel and Research Grants': CEAS_SOURCE_URL,
        'International Security Studies (ISS) Short-term Research and Travel Award':
          firstOfficialYaleLinkedUrl(program),
        'Lindsay Fellowship for Research in Africa': LINDSAY_FELLOWSHIP_SOURCE_URL,
        'Mobley Family Environmental Humanities Summer Student Research Grants': MOBLEY_FUNDING_SOURCE_URL,
      };
      const sourceUrl = sourceUrlByTitle[title];
      addRepairIfChanged(
        repairs,
        program,
        'suppress_graduate_or_professional_travel_grant',
        {
          ...(sourceUrl ? { sourceUrl } : {}),
          undergraduateOnly: false,
          yaleCollegeOnly: false,
          studentFacingCategory: 'Archive / review',
          studentVisibilityOverrideTier: 'suppressed',
          studentVisibilitySuppressionReason: 'graduate_or_professional_only',
        },
      );
      continue;
    }

    if (title === "Shana Alexander Research Fellowship in Women's, Gender, and Sexuality Studies") {
      addRepairIfChanged(
        repairs,
        program,
        'repair_shana_alexander_research_fellowship',
        {
          sourceUrl:
            'https://wgss.yale.edu/undergrate-program/prizes-fellowships/shana-alexander-research-fellowship',
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'FELLOWSHIP_FUNDING',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          studentFacingCategory: 'Undergraduate research fellowship',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          compensationSummary: 'Research fellowship funding when awarded',
          programDates: 'Spring application cycle',
          summary:
            'WGSS undergraduate research fellowship for original projects in women’s, gender, and sexuality studies.',
          description:
            'The Shana Alexander Research Fellowship supports original undergraduate research projects in women’s, gender, and sexuality studies, with preference for work that can contribute to a senior essay and is not substantially funded elsewhere.',
          bestNextStep:
            'Review the WGSS fellowship page, confirm the current deadline, and prepare a research proposal connected to a faculty-advised project.',
          prepSteps: [
            'Official WGSS fellowship page',
            'Research proposal',
            'Faculty-advised project plan',
            'Current deadline check',
          ],
          sourceKey: 'wgss:shana-alexander-research-fellowship',
        },
      );
      continue;
    }

    if (title === 'Solomon Research Fellowship in LGBT Studies') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_solomon_lgbt_research_fellowship',
        {
          sourceUrl: 'https://lgbts.yale.edu/fellowships-prizes',
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'FELLOWSHIP_FUNDING',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          studentFacingCategory: 'Undergraduate research fellowship',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          compensationSummary: 'Research fellowship funding when awarded',
          programDates: 'Annual',
          summary:
            'LGBT Studies undergraduate research fellowship supporting original projects in sexuality and LGBTQ studies.',
          description:
            'The Solomon Research Fellowship in LGBT Studies supports original undergraduate research projects in sexuality studies, especially lesbian, gay, bisexual, transgender, and queer studies.',
          bestNextStep:
            'Review the LGBT Studies fellowships page and prepare a source-backed undergraduate research proposal before applying.',
          prepSteps: [
            'Official LGBT Studies page',
            'Research proposal',
            'Faculty or program fit',
            'Current deadline check',
          ],
          sourceKey: 'lgbt-studies:solomon-research-fellowship',
        },
      );
      continue;
    }

    if (
      title === 'James T. King French Major Research Grant' ||
      title === 'Kenneth Cornell French Major Research Grant' ||
      title === 'Kenneth Cornell Memorial Undergraduate Research Grant for French Francophone Studies'
    ) {
      if (String(program._id) === '6982c1cf781efc3253d584c9') {
        addRepairIfChanged(
          repairs,
          program,
          'suppress_duplicate_french_research_grant',
          {
            studentFacingCategory: 'Archive / review',
            studentVisibilityOverrideTier: 'suppressed',
            studentVisibilitySuppressionReason: 'duplicate_program_record',
          },
        );
        continue;
      }
      const repairedTitle =
        title === 'Kenneth Cornell Memorial Undergraduate Research Grant for French Francophone Studies'
          ? 'Kenneth Cornell French Major Research Grant'
          : title;
      addRepairIfChanged(
        repairs,
        program,
        'repair_french_major_research_grant',
        {
          ...(repairedTitle !== title ? { title: repairedTitle } : {}),
          sourceUrl: 'https://french.yale.edu/undergraduate-program/french-grants-and-prizes',
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'TRAVEL_RESEARCH_GRANT',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          studentFacingCategory: 'Undergraduate research travel grant',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: true,
          compensationSummary: 'Up to $2,000 when awarded',
          programDates: 'Fall application cycle',
          summary:
            'French Department research grant for declared French majors or double majors planning short research travel tied to senior-thesis work.',
          description:
            'The French Department offers the Kenneth Cornell and James T. King French Major Research Grants for undergraduates who have declared a French major or double major. The grants support short travel for research that can contribute to senior-thesis work, after consultation with a French faculty member.',
          bestNextStep:
            'Review the French Grants and Prizes page, consult a French faculty member about the proposed research trip, and prepare the one-page proposal.',
          prepSteps: [
            'Official French grants page',
            'Declared French major or double major',
            'Faculty consultation',
            'One-page research proposal',
          ],
          sourceKey: `french-department:${slugifyKeyPart(repairedTitle)}`,
        },
      );
      continue;
    }

    if (title === 'Salo W. and Jeannette M. Baron Student Research Grants') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_baron_student_research_grants',
        {
          sourceUrl: 'https://ypsa.yale.edu/academics/student-research-grants',
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'TRAVEL_RESEARCH_GRANT',
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
          studentFacingCategory: 'Student research grant',
          requiresMentorBeforeApply: true,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: false,
          compensationSummary: '$500-$2,500 typical grant range when awarded',
          programDates: 'Annual',
          summary:
            'YPSA student research grants for current Yale undergraduate or graduate students pursuing focused research on antisemitism.',
          description:
            'The Salo W. and Jeannette M. Baron Student Research Grants support current Yale undergraduate or graduate students pursuing focused research on antisemitism. Grants can fund travel or Yale-based research, and recipients are expected to present a research paper at a YPSA colloquium.',
          bestNextStep:
            'Review the YPSA grant page and prepare a focused antisemitism research proposal with a realistic budget and timeline.',
          prepSteps: [
            'Official YPSA grant page',
            'Focused research proposal',
            'Budget',
            'Presentation expectation review',
          ],
          sourceKey: 'ypsa:baron-student-research-grants',
        },
      );
      continue;
    }

    if (title === 'Yale Women Faculty Forum Seed Grant') {
      addRepairIfChanged(
        repairs,
        program,
        'repair_wff_seed_grant',
        {
          sourceUrl: 'https://wff.yale.edu/grants-awards/seed-grants/seed-grant-application',
          programCategory: 'RECURRING_PROGRAM',
          programKind: 'FELLOWSHIP_FUNDING',
          entryMode: 'APPLY_TO_PROGRAM',
          studentFacingCategory: 'University research seed grant',
          requiresMentorBeforeApply: false,
          mentorMatching: false,
          undergraduateOnly: true,
          yaleCollegeOnly: false,
          compensationSummary: '$200-$2,000 seed grant range when awarded',
          programDates: 'Fall and Spring cycles',
          summary:
            'Women Faculty Forum seed grant for Yale scholars, including undergraduates, pursuing research or innovative projects related to gender equity and gender studies.',
          description:
            'The Yale Women Faculty Forum Seed Grant supports research and innovative projects by Yale undergraduates, graduate students, postdoctoral scholars, faculty, and staff. Projects should advance WFF’s mission around gender equity, scholarship on women and gender, or mentorship and collaboration.',
          bestNextStep:
            'Review the WFF seed grant page, confirm the current cycle deadline, and prepare a short project description, abstract, budget, and CV or resume.',
          prepSteps: [
            'Official WFF seed grant page',
            'Project description',
            'Project abstract',
            'Budget',
            'CV or resume',
          ],
          sourceKey: 'women-faculty-forum:seed-grant',
        },
      );
      continue;
    }

    const richerOfficialSourceUrl = officialSourceUrlByExactTitle.get(title);
    if (richerOfficialSourceUrl) {
      addRepairIfChanged(
        repairs,
        program,
        'promote_verified_program_source_url',
        {
          sourceUrl: richerOfficialSourceUrl,
        },
      );
    }

    if (!richerOfficialSourceUrl && !program.sourceUrl) {
      const officialUrl = firstOfficialYaleLinkedUrl(program);
      const hasAudienceDecision =
        program.undergraduateOnly === true ||
        program.yaleCollegeOnly === true ||
        program.undergraduateOnly === false ||
        program.studentFacingCategory === 'Archive / review';
      if (officialUrl && hasAudienceDecision) {
        addRepairIfChanged(
          repairs,
          program,
          'promote_reviewed_official_route_to_source_url',
          {
            sourceUrl: officialUrl,
          },
        );
      }
    }
  }

  return repairs;
}

async function main() {
  const apply = process.argv.includes('--apply');
  await initializeConnections();
  const repairs = await planProgramRepairs();

  if (apply) {
    assertScriptApplyAllowed({
      apply,
      scriptName: 'repair-program-source-metadata',
      mongoUrl: process.env.MONGODBURL,
    });
    for (const repair of repairs) {
      await Fellowship.updateOne({ _id: repair.id }, { $set: repair.update });
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        planned: repairs.length,
        byReason: repairs.reduce<Record<string, number>>((acc, repair) => {
          acc[repair.reason] = (acc[repair.reason] || 0) + 1;
          return acc;
        }, {}),
        samples: repairs.slice(0, 20),
        recommendedFollowUp: apply
          ? 'Run yarn --cwd server student-visibility:backfill --apply --collection=programs so stored studentVisibilityTier reflects any override changes.'
          : undefined,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
