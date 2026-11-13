import type { LabSiteLeadVerdict } from '../../../../models/storedVocabularies';
import type { LabSiteLeadCandidate } from '../../labSiteLeadVerification';

export interface LabSiteFixturePage {
  url: string;
  html: string;
}

export interface ExpectedLeadVerdict {
  verdict: LabSiteLeadVerdict;
  matchedBy?: string;
  contradictedBy?: string;
}

export interface LabSiteLeadStatementFixture {
  name: string;
  rowName: string;
  entityType: string;
  website: string;
  pages: LabSiteFixturePage[];
  leads: LabSiteLeadCandidate[];
  expected: Record<string, ExpectedLeadVerdict>;
}

const QUILL = '000000000000000000000001';
const BROOK = '000000000000000000000002';

const person = (
  personId: string,
  displayName: string,
  profileSlug: string,
  role = 'PI',
): LabSiteLeadCandidate => ({
  personId,
  role,
  displayName,
  officialProfileUrls: profileSlug ? [`https://medicine.yale.edu/profile/${profileSlug}/`] : [],
});

const page = (title: string, body: string, h1 = title) =>
  `<html><head><title>${title}</title></head><body><h1>${h1}</h1><main>${body}</main></body></html>`;

const card = (name: string, title: string, href = '') =>
  `<div class="person"><h3>${href ? `<a href="${href}">${name}</a>` : name}</h3><p>${title}</p></div>`;

/**
 * Synthetic lab-site pages for the row-anchored lead statement rules (#5962). Every name,
 * row and URL is invented. `expected` is the verdict each lead should receive once a lead
 * statement counts only when it is anchored to the row it is read for.
 */
export const LAB_SITE_LEAD_STATEMENT_FIXTURES: LabSiteLeadStatementFixture[] = [
  {
    name: 'a postdoc listed on the team page beside the stated PI is listed in a non-lead role',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/people/',
        html: page(
          'People | Tidal Imaging Lab',
          card('Robin Quill', 'Principal Investigator', '/profile/robin-quill/') +
            card('Ada Brook', 'Postdoctoral Fellow', '/profile/ada-brook/'),
          'Tidal Imaging Lab',
        ),
      },
    ],
    leads: [person(QUILL, 'Robin Quill', 'robin-quill'), person(BROOK, 'Ada Brook', 'ada-brook')],
    expected: {
      [QUILL]: { verdict: 'CONFIRMED' },
      [BROOK]: { verdict: 'CONTRADICTED', contradictedBy: 'LISTED_IN_NON_LEAD_ROLE' },
    },
  },
  {
    name: 'a lead linked as a contact on a page that says another person oversees the row is named as not the lead',
    rowName: 'Developmental Signals Lab (DSL)',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/childstudy/dsl/',
    pages: [
      {
        url: 'https://medicine.yale.edu/childstudy/dsl/',
        html: page(
          'Developmental Signals Lab',
          '<p>Overseen by Dr. Dale Fenwick, the DSL is a collaborative lab shared by several research teams.</p>' +
            '<p>For questions, contact <a href="/profile/ada-brook/">Ada Brook</a>.</p>',
        ),
      },
    ],
    leads: [person(BROOK, 'Ada Brook', 'ada-brook')],
    expected: {
      [BROOK]: { verdict: 'CONTRADICTED', contradictedBy: 'NAMED_AS_LEAD' },
    },
  },
  {
    name: 'co-directors of a center named in their own cards confirm each other',
    rowName: 'Center for Tidal Studies',
    entityType: 'CENTER',
    website: 'https://tidal.yale.edu/',
    pages: [
      {
        url: 'https://tidal.yale.edu/people/',
        html: page(
          'Center for Tidal Studies',
          card('Robin Quill', 'Faculty Director', '/profile/robin-quill/') +
            card('Ada Brook', 'Co-Director', '/profile/ada-brook/'),
        ),
      },
    ],
    leads: [
      person(QUILL, 'Robin Quill', 'robin-quill', 'DIRECTOR'),
      person(BROOK, 'Ada Brook', 'ada-brook', 'CO_DIRECTOR'),
    ],
    expected: {
      [QUILL]: { verdict: 'CONFIRMED' },
      [BROOK]: { verdict: 'CONFIRMED' },
    },
  },
  {
    name: 'a division page sentence about labs led by another person names no lead of this row',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/',
        html: page(
          'Division of Coastal Medicine',
          '<p>The division includes labs led by <a href="/profile/ada-brook/">Ada Brook</a> and others.</p>',
        ),
      },
    ],
    leads: [person(QUILL, 'Robin Quill', 'robin-quill')],
    expected: {
      [QUILL]: { verdict: 'UNSTATED' },
    },
  },
  {
    name: 'a bare principal investigator heading on a page that is not the row own page anchors nothing',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/',
        html: page(
          'Coastal Medicine Section',
          '<h2>Principal Investigator</h2><a href="/lab/tidal/profile/ada-brook/">Ada Brook, PhD</a>',
        ),
      },
    ],
    leads: [person(QUILL, 'Robin Quill', 'robin-quill')],
    expected: {
      [QUILL]: { verdict: 'UNSTATED' },
    },
  },
  {
    name: 'a principal investigator card on the row own page names another person as the lead',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/',
        html: page(
          'Tidal Imaging Lab',
          card('Ada Brook', 'Principal Investigator', '/lab/tidal/profile/ada-brook/'),
        ),
      },
    ],
    leads: [person(QUILL, 'Robin Quill', 'robin-quill')],
    expected: {
      [QUILL]: { verdict: 'CONTRADICTED', contradictedBy: 'NAMED_AS_LEAD' },
    },
  },
  {
    name: 'a staff director qualified by another unit is not a lead of the row',
    rowName: 'Center for Tidal Studies',
    entityType: 'CENTER',
    website: 'https://tidal.yale.edu/',
    pages: [
      {
        url: 'https://tidal.yale.edu/',
        html: page(
          'Center for Tidal Studies',
          card('Ada Brook', 'Director of Engagement and Operations, Center for Tidal Studies'),
        ),
      },
    ],
    leads: [person(QUILL, 'Robin Quill', 'robin-quill', 'DIRECTOR')],
    expected: {
      [QUILL]: { verdict: 'UNSTATED' },
    },
  },
  {
    name: 'a related core teaser card naming its own director is not read for the row',
    rowName: 'Tidal Imaging Core',
    entityType: 'CORE',
    website: 'https://medicine.yale.edu/core/tidal-imaging/',
    pages: [
      {
        url: 'https://medicine.yale.edu/core/tidal-imaging/',
        html: page(
          'Tidal Imaging Core',
          '<p>The core offers coastal imaging services.</p>' +
            '<div class="related"><div class="core-card"><h3><a href="https://medicine.yale.edu/core/reef-genomics/">Reef Genomics Core</a></h3>' +
            '<p>Ada Brook, Faculty Director</p><a href="/profile/ada-brook/">Profile</a></div>' +
            '<div class="core-card"><h3><a href="https://medicine.yale.edu/core/kelp-proteomics/">Kelp Proteomics Core</a></h3>' +
            '<p>Dale Fenwick, Faculty Director</p><a href="/profile/dale-fenwick/">Profile</a></div></div>',
        ),
      },
    ],
    leads: [person(QUILL, 'Robin Quill', 'robin-quill', 'DIRECTOR')],
    expected: {
      [QUILL]: { verdict: 'UNSTATED' },
    },
  },
  {
    name: 'a title line pairs with the name in its own card, not with the next name',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/people/',
        html: page(
          'Tidal Imaging Lab',
          card('Ada Brook', 'Lab Manager') + card('Robin Quill', 'Principal Investigator'),
        ),
      },
    ],
    leads: [person(QUILL, 'Robin Quill', 'robin-quill'), person(BROOK, 'Ada Brook', 'ada-brook')],
    expected: {
      [QUILL]: { verdict: 'CONFIRMED' },
      [BROOK]: { verdict: 'CONTRADICTED', contradictedBy: 'LISTED_IN_NON_LEAD_ROLE' },
    },
  },
  {
    name: 'a person card whose name and title sit inside a header element is still read',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/people/',
        html: page(
          'Tidal Imaging Lab',
          '<article class="profile"><header><h3>Robin Quill</h3><p>Principal Investigator</p></header></article>' +
            '<article class="profile"><header><h3>Ada Brook</h3><p>Postdoctoral Associate</p></header></article>',
        ),
      },
    ],
    leads: [person(QUILL, 'Robin Quill', 'robin-quill'), person(BROOK, 'Ada Brook', 'ada-brook')],
    expected: {
      [QUILL]: { verdict: 'CONFIRMED' },
      [BROOK]: { verdict: 'CONTRADICTED', contradictedBy: 'LISTED_IN_NON_LEAD_ROLE' },
    },
  },
  {
    name: 'a role prefix before the stated name is not read as part of the name',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/',
        html: page(
          'Tidal Imaging Lab',
          '<p>The lab is led by PI Prof. Dale Fenwick and studies coastal imaging.</p>',
        ),
      },
    ],
    leads: [person(QUILL, 'Robin Quill', 'robin-quill')],
    expected: {
      [QUILL]: { verdict: 'CONTRADICTED', contradictedBy: 'NAMED_AS_LEAD' },
    },
  },
  {
    name: 'faculty contacts on a multi-PI site stay confirmed',
    rowName: 'Coastal Cognition Lab',
    entityType: 'LAB',
    website: 'https://coastal-cognition.yale.edu/',
    pages: [
      {
        url: 'https://coastal-cognition.yale.edu/',
        html: page(
          'Coastal Cognition Lab',
          card('Robin Quill', 'Faculty Contact') + card('Ada Brook', 'Faculty Contact'),
        ),
      },
    ],
    leads: [person(QUILL, 'Robin Quill', 'robin-quill'), person(BROOK, 'Ada Brook', 'ada-brook')],
    expected: {
      [QUILL]: { verdict: 'CONFIRMED' },
      [BROOK]: { verdict: 'CONFIRMED' },
    },
  },
  {
    name: 'a self-referencing lead sentence on the row own page names another person as the lead',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/',
        html: page(
          'Tidal Imaging Lab',
          '<p>Our lab is directed by Dale Fenwick and studies coastal imaging.</p>',
        ),
      },
    ],
    leads: [person(BROOK, 'Ada Brook', 'ada-brook')],
    expected: {
      [BROOK]: { verdict: 'CONTRADICTED', contradictedBy: 'NAMED_AS_LEAD' },
    },
  },
  {
    name: 'a self-referencing lead sentence on a page that is not the row own page anchors nothing',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/',
        html: page(
          'Coastal Medicine Section',
          '<p>Our lab is directed by Dale Fenwick and studies coastal imaging.</p>',
        ),
      },
    ],
    leads: [person(BROOK, 'Ada Brook', 'ada-brook')],
    expected: {
      [BROOK]: { verdict: 'UNSTATED' },
    },
  },
  {
    name: 'a sentence naming the row as its subject anchors a lead on any page',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/',
        html: page(
          'Coastal Medicine Section',
          '<p>The Tidal Imaging Lab, led by Dale Fenwick, studies coastal imaging.</p>',
        ),
      },
    ],
    leads: [person(BROOK, 'Ada Brook', 'ada-brook')],
    expected: {
      [BROOK]: { verdict: 'CONTRADICTED', contradictedBy: 'NAMED_AS_LEAD' },
    },
  },
  {
    name: 'a lead sentence about another unit on the row own page is ignored',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/',
        html: page(
          'Tidal Imaging Lab',
          '<p>We use the Reef Genomics Core, directed by <a href="/profile/ada-brook/">Ada Brook</a>, for sequencing.</p>',
        ),
      },
    ],
    leads: [person(QUILL, 'Robin Quill', 'robin-quill')],
    expected: {
      [QUILL]: { verdict: 'UNSTATED' },
    },
  },
  {
    name: 'a lead sentence naming somebody who could be the lead never contradicts the lead',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/',
        html: page('Tidal Imaging Lab', '<p>The lab is led by Robina Quill.</p>'),
      },
    ],
    leads: [person(QUILL, 'R. M. Quill', '')],
    expected: {
      [QUILL]: { verdict: 'UNSTATED' },
    },
  },
  {
    name: 'a row lead sentence confirms a lead the page names but whose display name is a given name only',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/',
        html: page('Tidal Imaging Lab', '<p>The lab is led by Robin Quill.</p>'),
      },
    ],
    leads: [person(QUILL, 'Robin', 'robin-quill')],
    expected: {
      [QUILL]: { verdict: 'CONFIRMED', matchedBy: 'NAMED_AS_ROW_LEAD' },
    },
  },
  {
    name: 'a faculty and an executive director of a center both named as directors confirm each other',
    rowName: 'Center for Tidal Studies',
    entityType: 'CENTER',
    website: 'https://tidal.yale.edu/',
    pages: [
      {
        url: 'https://tidal.yale.edu/about/',
        html: page(
          'Center for Tidal Studies',
          card('Robin Quill', 'Faculty Director') + card('Ada Brook', 'Executive Director'),
        ),
      },
    ],
    leads: [
      person(QUILL, 'Robin Quill', 'robin-quill', 'DIRECTOR'),
      person(BROOK, 'Ada Brook', 'ada-brook', 'DIRECTOR'),
    ],
    expected: {
      [QUILL]: { verdict: 'CONFIRMED' },
      [BROOK]: { verdict: 'CONFIRMED' },
    },
  },
  {
    name: 'a page heading that parses like a name is never an outsider stated as lead',
    rowName: 'Center for Tidal Studies',
    entityType: 'CENTER',
    website: 'https://tidal.yale.edu/',
    pages: [
      {
        url: 'https://tidal.yale.edu/',
        html: page(
          'Center for Tidal Studies',
          '<div class="person"><h3>Senior Lecturer</h3><p>Director</p></div>' +
            '<div class="person"><h3>Chief Strategy Officer</h3><p>Principal Investigator</p></div>',
        ),
      },
    ],
    leads: [person(QUILL, 'Robin Quill', 'robin-quill', 'DIRECTOR')],
    expected: {
      [QUILL]: { verdict: 'UNSTATED' },
    },
  },
  {
    name: 'a director card naming nobody shown to be a person never contradicts',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/',
        html: page('Tidal Imaging Lab', card('Dale Fenwick', 'Principal Investigator')),
      },
    ],
    leads: [person(QUILL, 'Robin Quill', 'robin-quill')],
    expected: {
      [QUILL]: { verdict: 'UNSTATED' },
    },
  },
  {
    name: 'a bare principal investigator card never overturns a lead the site already names',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/people/',
        html: page(
          'Tidal Imaging Lab',
          card('Dale Fenwick, PhD', 'Principal Investigator') +
            card('Robin Quill', 'Research Scientist', '/profile/robin-quill/'),
        ),
      },
    ],
    leads: [person(QUILL, 'Robin Quill', 'robin-quill')],
    expected: {
      [QUILL]: { verdict: 'CONFIRMED' },
    },
  },
  {
    name: 'a lead the site lists under an unlisted director title is never contradicted',
    rowName: 'Tidal Imaging Core',
    entityType: 'CORE',
    website: 'https://research.yale.edu/cores/tidal-imaging',
    pages: [
      {
        url: 'https://research.yale.edu/cores/tidal-imaging',
        html: page(
          'Tidal Imaging Core',
          card('Robin Quill, PhD', 'Scientific Director') +
            card('Dale Fenwick, PhD', 'Faculty Director', '/profile/dale-fenwick/'),
        ),
      },
    ],
    leads: [person(QUILL, 'Robin', 'robin-quill', 'DIRECTOR')],
    expected: {
      [QUILL]: { verdict: 'UNSTATED' },
    },
  },
  {
    name: 'a lead whose compound surname the page writes in part is still named',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/',
        html: page('Tidal Imaging Lab', '<p>The lab is led by Robin Quill and studies tides.</p>'),
      },
    ],
    leads: [person(QUILL, 'Robin Quill Brook', '')],
    expected: {
      [QUILL]: { verdict: 'CONFIRMED', matchedBy: 'NAMED_AS_ROW_LEAD' },
    },
  },
  {
    name: 'a former member listed as a principal investigator elsewhere on an alumni page is ignored',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/members/alumni/',
        html: page(
          'Lab Alumni | Tidal Imaging Lab',
          card('Dale Fenwick, PhD', 'Principal Investigator', '/profile/dale-fenwick/') +
            card('Ada Brook, PhD', 'Principal Investigator', '/profile/ada-brook/'),
          'Lab Alumni',
        ),
      },
    ],
    leads: [person(QUILL, 'Robin Quill', 'robin-quill')],
    expected: {
      [QUILL]: { verdict: 'UNSTATED' },
    },
  },
  {
    name: 'an address in a lead card never reads as a staff role',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/contact/',
        html: page(
          'Tidal Imaging Lab',
          card('Robin Quill', 'Coastal Research Building, Room 112') +
            card('Ada Brook', 'Graduate Student'),
        ),
      },
    ],
    leads: [person(QUILL, 'Robin Quill', 'robin-quill')],
    expected: {
      [QUILL]: { verdict: 'CONFIRMED' },
    },
  },
  {
    name: 'a professor whose card mentions a past postdoc is not listed as a postdoc',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/people/',
        html: page(
          'Tidal Imaging Lab',
          card('Robin Quill', 'Assistant Professor of Chemistry; Postdoc, Reef University') +
            card('Ada Brook', 'Graduate Student'),
        ),
      },
    ],
    leads: [person(QUILL, 'Robin Quill', 'robin-quill')],
    expected: {
      [QUILL]: { verdict: 'CONFIRMED' },
    },
  },
  {
    name: 'a lone byline above a job advert never lists the lead in the advertised role',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/positions/',
        html: page(
          'Tidal Imaging Lab',
          '<article><span>Robin Quill</span><h2>Postdoctoral Associate</h2><p>We are looking for creative postdocs.</p></article>',
        ),
      },
    ],
    leads: [person(QUILL, 'Robin Quill', 'robin-quill')],
    expected: {
      [QUILL]: { verdict: 'CONFIRMED' },
    },
  },
  {
    name: 'a news item saying who led an initiative is not a statement about the row lead',
    rowName: 'Tidal Imaging Lab',
    entityType: 'LAB',
    website: 'https://medicine.yale.edu/lab/tidal/',
    pages: [
      {
        url: 'https://medicine.yale.edu/lab/tidal/news-article/tidal-symposium/',
        html: page(
          'Tidal Symposium | Tidal Imaging Lab',
          '<p>The initiative was led by Dale Fenwick, PhD, and Robin Quill, PhD.</p>',
          'Tidal Imaging Lab',
        ),
      },
    ],
    leads: [person(QUILL, 'Robin Quill', 'robin-quill')],
    expected: {
      [QUILL]: { verdict: 'CONFIRMED' },
    },
  },
];
