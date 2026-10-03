import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STUDENT_GRANTS_SEARCH_URL,
  STUDENT_GRANTS_DATABASE_SOURCE,
  StudentGrantsDatabaseScraper,
  createRenderedStudentGrantsHtmlFetcher,
  createStudentGrantsDetailFetcher,
  fundToObservations,
  isRecordSpecificFundDetailUrl,
  isRetiredFundPage,
  parseFundDetailPage,
  parseFundSearchResults,
  sourceKeyForFund,
} from '../sources/studentGrantsDatabaseScraper';
import type { ObservationInput, ScraperContext } from '../types';
import { classificationFromObservedFacts } from '../fellowshipClassificationDerivation';
import type { FundSearchGrid, FundSearchGridRow } from '../utils/communityForceFundSearch';
import { beginBenchmarkCapture, finishBenchmarkCapture } from '../snapshotBenchmarkMode';

const FUND_A_URL =
  'https://yale.communityforce.com/Funds/FundDetails.aspx?B4C5D6E7F8091A2B3C4D5E6F';
const FUND_B_URL = 'https://yale.communityforce.com/Funds/FundDetails.aspx?FundID=42';

const SEARCH_RESULTS_HTML = `
  <html><body>
    <nav><a href="/Login.aspx">Login</a></nav>
    <ul class="fund-results">
      <li>
        <a href="${FUND_A_URL}">Richter Summer Research Fellowship</a>
        <span>Deadline: February 12, 2099</span>
      </li>
      <li>
        <a href="/Funds/FundDetails.aspx?FundID=42">Global Health Travel Grant</a>
      </li>
      <li>
        <a href="/Funds/FundDetails.aspx?FundID=42" title="Global Health Travel Grant">Learn more</a>
      </li>
      <li><a href="https://yale.communityforce.com/">Back to portal home</a></li>
      <li><a href="/Funds/Search.aspx">Search all funds</a></li>
      <li><a href="https://example.com/apply">External page</a></li>
    </ul>
  </body></html>
`;

const P = 'ctl00_PreContent_FundDetails1_';

function facetPanel(id: number, label: string, values: string[]): string {
  const items = values.map((value) => `<li> ${value}</ li>`).join('');
  return `<div id="${P}${id}"><DIV id="${P}divHeader_${id}"><img src="../Images/plus.gif" /> <b>${label}</b></DIV></div>
    <div id="${P}pnlBody_${id}"><DIV id="${P}divBody_${id}"><ul id='ul${id}'>${items}<ul></DIV></div>`;
}

function fundDetailHtml(
  options: {
    opens?: string;
    deadline?: string;
    closedOn?: string;
    award?: string;
    title?: string;
    brief?: string;
    fullDescription?: string;
    applicationInformation?: string;
    eligibility?: string;
    yearOfStudy?: string[];
  } = {},
): string {
  const {
    opens = '1/15/2099',
    deadline = '2/12/2099 12:00 PM',
    closedOn = '',
    award = '',
    title = 'Fixture Summer Research Fellowship',
    brief = 'The fellowship funds independent summer research projects proposed by Yale College undergraduates working under a faculty mentor.',
    fullDescription = '',
    applicationInformation = '',
    eligibility = 'Enrolled Yale College undergraduates in good standing.',
    yearOfStudy = ['Sophomore', 'Junior'],
  } = options;
  const section = (heading: string, body: string) =>
    body ? `<h1 class='Grant_Criteria_hd'>${heading}:</h1>${body}` : '';
  return `
  <html><body>
    <nav><a href="/Login.aspx">Login</a></nav>
    <div class="fdi-date-info">
      <div id="${P}spnBeginApplication" class="fdi-start-date-title"> Begin Accepting Applications Date: </div>
      <div class="fdi-start-date"> ${opens} </div>
      <div id="${P}spnDeadlineApplication" class="fdi-start-date-title"> <strong>Deadline Date (EST Time Zone):</strong> </div>
      <div class="fdi-start-date"> ${deadline} </div>
    </div>
    <span id="${P}lblFundName">${title}</span>
    <span id="${P}lblAwardAmount">${award}</span>
    <span id="${P}lblFundClosedOn">${closedOn}</span>
    <span id="${P}lblReasonClosed"></span>
    <span id="${P}lblBriefDescription">${section('Brief Description', brief)}</span>
    <span id="${P}lblDescription">${section('Description', fullDescription)}</span>
    <span id="${P}lblApplicationInformation">${section('Application Information', applicationInformation)}</span>
    <span id="${P}lblSpecialEligibilityRequirements">${section('Special Eligibility Requirements', eligibility)}</span>
    <span id="${P}lblRestrictionstoUseofAward"></span>
    <span id="${P}lblFundContactInformation"><h1 class='Grant_Criteria_hd'>Contact Information:</h1>For questions, contact <a href=mailto:fixture.contact@example.org>fixture.contact@example.org</a></span>
    <span id="${P}lblEligibilityRequirements"><h1 class='Grant_Criteria_hd'>Search Filters:</h1></span>
    ${facetPanel(1, 'Current Year of Study', yearOfStudy)}
    ${facetPanel(2, 'Term of Award', ['Summer'])}
    ${facetPanel(3, 'Grant or Fellowship Purpose', ['Research', 'Travel'])}
    ${facetPanel(4, 'Global Region or Country', ['Europe', '-- France (Western Europe)', 'Asia', '-- Japan (East Asia)'])}
    ${facetPanel(5, 'Citizenship Status', ['U.S. citizens are eligible'])}
  </body></html>`;
}

const FUND_A_DETAIL_HTML = fundDetailHtml({ award: 'Award Amount: $4,000' });

const AUTH_SHELL_HTML = `
  <html><body>
    <div id="ctl00_PreContent">
      <h1 class='Grant_Criteria_hd'>Search Filters:</h1>
      <a href="/Login.aspx">Login</a>
    </div>
  </body></html>
`;

function makeContext(overrides: Partial<ScraperContext['options']> = {}): {
  ctx: ScraperContext;
  emitted: ObservationInput[];
} {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'run-test',
    sourceId: 'source-test',
    sourceName: STUDENT_GRANTS_DATABASE_SOURCE,
    sourceWeight: 0.95,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      ...overrides,
    },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => {},
  };
  return { ctx, emitted };
}

describe('isRecordSpecificFundDetailUrl', () => {
  it('accepts a FundDetails page with a query string', () => {
    expect(isRecordSpecificFundDetailUrl(FUND_A_URL)).toBe(true);
    expect(isRecordSpecificFundDetailUrl(FUND_B_URL)).toBe(true);
  });

  it('rejects the bare portal root, the search index, and non-CommunityForce hosts', () => {
    expect(isRecordSpecificFundDetailUrl('https://yale.communityforce.com/')).toBe(false);
    expect(isRecordSpecificFundDetailUrl('https://yale.communityforce.com/Funds/Search.aspx')).toBe(
      false,
    );
    expect(
      isRecordSpecificFundDetailUrl('https://yale.communityforce.com/Funds/FundDetails.aspx'),
    ).toBe(false);
    expect(isRecordSpecificFundDetailUrl('https://example.com/FundDetails.aspx?x=1')).toBe(false);
    expect(isRecordSpecificFundDetailUrl(undefined)).toBe(false);
  });
});

describe('parseFundSearchResults', () => {
  it('enumerates record-specific FundDetails links, deduped, ignoring roots and off-host links', () => {
    const funds = parseFundSearchResults(SEARCH_RESULTS_HTML, DEFAULT_STUDENT_GRANTS_SEARCH_URL);
    const urls = funds.map((fund) => fund.url).sort();
    expect(urls).toEqual([FUND_A_URL, FUND_B_URL].sort());
    const globalHealth = funds.find((fund) => fund.url === FUND_B_URL);
    expect(globalHealth?.title).toBe('Global Health Travel Grant');
  });
});

describe('parseFundDetailPage', () => {
  const referenceDate = new Date('2099-02-01T00:00:00Z');

  it('reads each field from its own element on a server-rendered fund page', () => {
    const fund = parseFundDetailPage(
      FUND_A_DETAIL_HTML,
      { title: '', url: FUND_A_URL },
      referenceDate,
    );
    expect(fund).toMatchObject({
      title: 'Fixture Summer Research Fellowship',
      url: FUND_A_URL,
      sourceKey: sourceKeyForFund(FUND_A_URL),
      awardAmount: '$4,000',
      yearOfStudy: ['Sophomore', 'Junior'],
      termOfAward: ['Summer'],
      purpose: ['Research', 'Travel'],
      citizenshipStatus: ['U.S. citizens are eligible'],
      isAcceptingApplications: true,
    });
    expect(fund?.description).toMatch(/^The fellowship funds independent summer research/);
    expect(fund?.eligibility).toBe('Enrolled Yale College undergraduates in good standing.');
    expect(fund?.applicationInformation).toBeUndefined();
  });

  it('takes the deadline and the opening date from their own labels', () => {
    const fund = parseFundDetailPage(
      FUND_A_DETAIL_HTML,
      { title: '', url: FUND_A_URL },
      referenceDate,
    );
    expect(fund?.deadline?.toISOString()).toBe('2099-02-12T17:00:00.000Z');
    expect(fund?.applicationOpenDate?.toISOString()).toBe('2099-01-15T05:00:00.000Z');
  });

  it('reads the deadline at the time the EST Time Zone label states, as New York time', () => {
    const deadlineOf = (deadline: string, opens = '1/15/2027') =>
      parseFundDetailPage(
        fundDetailHtml({ opens, deadline }),
        { title: '', url: FUND_A_URL },
        referenceDate,
      )?.deadline?.toISOString();
    expect(deadlineOf('3/24/2027 1:00 PM')).toBe('2027-03-24T17:00:00.000Z');
    expect(deadlineOf('2/24/2027 1:00 PM')).toBe('2027-02-24T18:00:00.000Z');
    expect(deadlineOf('11/10/2027 1:00 PM')).toBe('2027-11-10T18:00:00.000Z');
    expect(deadlineOf('3/24/2027')).toBe('2027-03-25T03:59:59.999Z');
  });

  it('reads a stated opening time and opens a date-only window at New York midnight', () => {
    const opensOf = (opens: string) =>
      parseFundDetailPage(
        fundDetailHtml({ opens }),
        { title: '', url: FUND_A_URL },
        referenceDate,
      )?.applicationOpenDate?.toISOString();
    expect(opensOf('9/01/2026 9:00 AM')).toBe('2026-09-01T13:00:00.000Z');
    expect(opensOf('9/01/2026')).toBe('2026-09-01T04:00:00.000Z');
  });

  it('stops accepting at the stated minute rather than at the end of the day', () => {
    const acceptingAt = (now: string) =>
      parseFundDetailPage(
        fundDetailHtml({ opens: '1/15/2027', deadline: '3/24/2027 1:00 PM' }),
        { title: '', url: FUND_A_URL },
        new Date(now),
      )?.isAcceptingApplications;
    expect(acceptingAt('2027-03-24T16:59:00.000Z')).toBe(true);
    expect(acceptingAt('2027-03-24T17:01:00.000Z')).toBe(false);
  });

  it('keeps regions and drops the countries listed under them', () => {
    const fund = parseFundDetailPage(
      FUND_A_DETAIL_HTML,
      { title: '', url: FUND_A_URL },
      referenceDate,
    );
    expect(fund?.globalRegions).toEqual(['Europe', 'Asia']);
  });

  it('never reads the contact block', () => {
    const fund = parseFundDetailPage(
      FUND_A_DETAIL_HTML,
      { title: '', url: FUND_A_URL },
      referenceDate,
    );
    expect(JSON.stringify(fund)).not.toContain('example.org');
  });

  it('fails closed on a page with no fund name', () => {
    expect(
      parseFundDetailPage(AUTH_SHELL_HTML, { title: 'Anything', url: FUND_A_URL }, referenceDate),
    ).toBeNull();
  });

  it('is not accepting before the window opens, after the deadline, or once closed', () => {
    const page = (options: Parameters<typeof fundDetailHtml>[0]) =>
      parseFundDetailPage(fundDetailHtml(options), { title: '', url: FUND_A_URL }, referenceDate);
    expect(page({ opens: '3/01/2099' })?.isAcceptingApplications).toBe(false);
    expect(page({ deadline: '1/20/2099' })?.isAcceptingApplications).toBe(false);
    expect(page({ closedOn: 'Closed on 1/25/2099' })?.isAcceptingApplications).toBe(false);
  });
});

describe('fundToObservations', () => {
  it('emits fellowship observations citing the fund detail URL as source and application link', () => {
    const fund = parseFundDetailPage(
      FUND_A_DETAIL_HTML,
      { title: '', url: FUND_A_URL },
      new Date('2099-02-01T00:00:00Z'),
    )!;
    const observations = fundToObservations(fund);
    const byField = new Map(observations.map((obs) => [obs.field, obs.value]));

    expect(observations.every((obs) => obs.entityType === 'fellowship')).toBe(true);
    expect(observations.every((obs) => obs.sourceUrl === FUND_A_URL)).toBe(true);
    expect(observations.every((obs) => obs.entityKey === fund.sourceKey)).toBe(true);
    expect(byField.get('sourceName')).toBe(STUDENT_GRANTS_DATABASE_SOURCE);
    expect(byField.get('sourceUrl')).toBe(FUND_A_URL);
    expect(byField.get('applicationLink')).toBe(FUND_A_URL);
    expect(byField.get('awardAmount')).toBe('$4,000');
    expect(byField.get('applicationOpenDate')).toEqual(new Date('2099-01-15T05:00:00.000Z'));
    expect(byField.get('archived')).toBe(false);
    expect([...byField.keys()]).not.toContain('contactEmail');
  });
});

describe('the application route a fund page names (#4216)', () => {
  const COMMON_APPLICATION_URL =
    'https://yale.communityforce.com/Funds/FundDetails.aspx?C0MM0NAPPL1CAT10N';
  const FORM_URL = 'https://forms.example.org/fixture-grant-form';
  const DEPARTMENT_URL = 'https://department.example.edu/funding';

  const observationsFor = (options: Parameters<typeof fundDetailHtml>[0]) => {
    const fund = parseFundDetailPage(fundDetailHtml(options), { title: '', url: FUND_A_URL })!;
    const observations = fundToObservations(fund);
    return {
      applicationLink: observations.find((obs) => obs.field === 'applicationLink')?.value,
      links: observations.find((obs) => obs.field === 'links')?.value,
    };
  };

  it('cites the common application the page says applications go through', () => {
    const { applicationLink, links } = observationsFor({
      brief: `Applications for this fellowship will be accepted via the <a href="${COMMON_APPLICATION_URL}">Fixture Summer Research Common Application</a>.`,
    });

    expect(applicationLink).toBe(COMMON_APPLICATION_URL);
    expect(links).toEqual([
      { label: 'Application', url: COMMON_APPLICATION_URL },
      { label: 'Fixture Summer Research Fellowship', url: FUND_A_URL },
    ]);
  });

  it('cites a form the page says to apply through directly', () => {
    expect(
      observationsFor({
        brief: `Please apply directly through this <a href="${FORM_URL}">form link</a>.`,
      }).applicationLink,
    ).toBe(FORM_URL);
  });

  it('cites the page it points to after saying the database does not take applications', () => {
    expect(
      observationsFor({
        applicationInformation: `Applications for this fellowship cannot be submitted via this database.<br>Please see <a href="${DEPARTMENT_URL}">Department Funding</a> for the application process.`,
      }).applicationLink,
    ).toBe(DEPARTMENT_URL);
  });

  it('keeps the fund page when the page says to apply through this database', () => {
    const { applicationLink, links } = observationsFor({
      applicationInformation: `ALL APPLICATIONS MUST BE SUBMITTED ONLINE THROUGH THIS DATABASE. See the <a href="${DEPARTMENT_URL}">program page</a> for details.`,
    });

    expect(applicationLink).toBe(FUND_A_URL);
    expect(links).toEqual([{ label: 'Application', url: FUND_A_URL }]);
  });

  it('keeps the fund page when a common application is mentioned but not required', () => {
    expect(
      observationsFor({
        brief: `If your project extends into the fall term, you should apply using the <a href="${COMMON_APPLICATION_URL}">Summer Fellowships Common Application</a>.`,
        applicationInformation:
          'All fellowships in this category share a common application form and deadline.',
      }).applicationLink,
    ).toBe(FUND_A_URL);
  });

  it('never routes to an email address', () => {
    expect(
      observationsFor({
        applicationInformation:
          'Please send your application to <a href="mailto:fixture.office@example.org">fixture.office@example.org</a>.',
      }).applicationLink,
    ).toBe(FUND_A_URL);
  });

  it('emits no application link when the page names a route elsewhere but links none', () => {
    const { applicationLink, links } = observationsFor({
      brief:
        'Note: Application to this fellowship competition will be via the Office of Fellowships Summer Research Common Application.',
    });

    expect(applicationLink).toBeUndefined();
    expect(links).toEqual([{ label: 'Fixture Summer Research Fellowship', url: FUND_A_URL }]);
  });

  it('keeps the fund page when a link only carries information or a separate admission', () => {
    for (const sentence of [
      `Detailed information and the official application may be found on the <a href="${DEPARTMENT_URL}">program website</a>.`,
      `Students must apply for admission separately through <a href="${DEPARTMENT_URL}">the summer session</a>.`,
      `Applicants who are not eligible to apply through any of the <a href="${DEPARTMENT_URL}">regional rounds</a> may apply here.`,
      `Applications from scholars who wish to pursue research using the <a href="${DEPARTMENT_URL}">fixture collection</a> are welcome.`,
    ]) {
      expect(observationsFor({ applicationInformation: sentence }).applicationLink).toBe(
        FUND_A_URL,
      );
    }
  });

  it('keeps the fund page when an unlinked common application is reached through its Apply button', () => {
    expect(
      observationsFor({
        applicationInformation:
          "Applicants must apply via the Fixture Common Application, accessible via the 'Apply' link.",
      }).applicationLink,
    ).toBe(FUND_A_URL);
  });

  it('applies to a common application page directly', () => {
    expect(
      observationsFor({
        title: 'Fixture Summer Research Common Application',
        brief:
          'Applications for these fellowships will be accepted via the Fixture Summer Research Common Application.',
      }).applicationLink,
    ).toBe(FUND_A_URL);
  });
});

describe('a contact direction in fund prose (#4177)', () => {
  const fundWith = (options: Parameters<typeof fundDetailHtml>[0]) =>
    parseFundDetailPage(fundDetailHtml(options), { title: '', url: FUND_A_URL })!;
  const witnessOf = (fund: ReturnType<typeof fundWith>) =>
    fundToObservations(fund).find((obs) => obs.field === 'sourceKey');

  it('stores no eligibility and says so when the section only says who to ask', () => {
    const fund = fundWith({
      eligibility:
        'Specific questions about projects should be addressed to Quill Fixture, senior administrative assistant for the program (<a href="mailto:quill.fixture@example.org">quill.fixture@example.org</a>).',
    });

    expect(fund.eligibility).toBeUndefined();
    expect(fundToObservations(fund).map((obs) => obs.field)).not.toContain('eligibility');
    expect(witnessOf(fund)?.assertsNoValueFor).toContain('eligibility');
  });

  it('keeps the requirements and drops the contact direction beside them', () => {
    const fund = fundWith({
      eligibility:
        '<p>Open only to sophomores and juniors in the residential college.</p><p>No previous recipients will be considered.</p><p>Contact Information:For questions about this application, please contact Quill Fixture.</p>',
    });

    expect(fund.eligibility).toBe(
      'Open only to sophomores and juniors in the residential college. No previous recipients will be considered.',
    );
    expect(fund.eligibility).not.toContain('Fixture');
    expect(witnessOf(fund)?.assertsNoValueFor ?? []).not.toContain('eligibility');
  });

  it('drops a contact direction from the other prose sections too', () => {
    const fund = fundWith({
      applicationInformation:
        'Submit a proposal and a budget.<br>For more information, please contact Quill Fixture.',
    });

    expect(fund.applicationInformation).toBe('Submit a proposal and a budget.');
  });

  it('keeps a requirement that only mentions emailing someone', () => {
    const fund = fundWith({
      eligibility: 'Recipients must email a final report to the dean within one month.',
    });

    expect(fund.eligibility).toBe(
      'Recipients must email a final report to the dean within one month.',
    );
  });

  it.each([
    'Applicants must email a one-page proposal answering the questions below.',
    'Proposals must be sent to the committee with additional information about the budget.',
  ])('keeps a requirement that only mentions questions beside a send verb: %s', (requirement) => {
    const fund = fundWith({ eligibility: requirement });

    expect(fund.eligibility).toBe(requirement);
    expect(witnessOf(fund)?.assertsNoValueFor ?? []).not.toContain('eligibility');
  });

  it.each([
    'Questions about eligibility should be directed to the program coordinator.',
    'Send any questions to the program coordinator.',
    'For further information, reach out to the program coordinator.',
    'Contact the program coordinator with any questions.',
  ])('drops a sentence that directs an enquiry: %s', (direction) => {
    const fund = fundWith({ eligibility: `<p>Open to juniors.</p><p>${direction}</p>` });

    expect(fund.eligibility).toBe('Open to juniors.');
  });

  it('states no eligibility when the section only labels a contact and asks for questions', () => {
    const fund = fundWith({
      eligibility:
        '<p>Contact: Quill Fixture, Program Coordinator.</p><p>Questions? Email Quill Fixture.</p>',
    });

    expect(fund.eligibility).toBeUndefined();
    expect(witnessOf(fund)?.assertsNoValueFor).toContain('eligibility');
  });

  it.each(['Call for proposals opens in May.', 'Emailed reports are due in May.'])(
    'keeps a requirement that only opens with a contact word: %s',
    (requirement) => {
      expect(fundWith({ eligibility: requirement }).eligibility).toBe(requirement);
    },
  );

  it('leaves a section with no contact direction exactly as it reads', () => {
    const fund = fundWith({
      eligibility: '<p>Open to juniors.</p><p>Seniors may apply.</p>',
    });

    expect(fund.eligibility).toBe('Open to juniors.Seniors may apply.');
  });

  it('claims nothing about an eligibility section the page leaves empty', () => {
    expect(witnessOf(fundWith({ eligibility: '' }))?.assertsNoValueFor ?? []).not.toContain(
      'eligibility',
    );
  });
});

describe('the fund Description section the classifier reads (#4232)', () => {
  const BRIEF = 'To provide funding to offset the costs associated with a senior research project.';
  const REQUIREMENT =
    'Each application must include the approval of a faculty advisor who will supervise the research project.';

  it('observes the whole Description section, so a requirement only it states is classified', () => {
    const fund = parseFundDetailPage(
      fundDetailHtml({
        brief: BRIEF,
        fullDescription: `The grants support senior projects. ${REQUIREMENT}`,
      }),
      { title: '', url: FUND_A_URL },
    )!;

    expect(fund.fullSourceDescription).toContain(REQUIREMENT);
    expect(
      classificationFromObservedFacts(fundToObservations(fund)).requiresMentorBeforeApply,
    ).toBe(true);
  });

  it('observes no Description on a page that has none', () => {
    const fund = parseFundDetailPage(fundDetailHtml({ brief: BRIEF }), {
      title: '',
      url: FUND_A_URL,
    })!;

    expect(fundToObservations(fund).map((obs) => obs.field)).not.toContain('fullSourceDescription');
  });
});

describe('the year of study a fund page admits (#4216)', () => {
  const yearOfStudyFor = (options: Parameters<typeof fundDetailHtml>[0]) =>
    parseFundDetailPage(fundDetailHtml(options), { title: '', url: FUND_A_URL })!.yearOfStudy;
  const ALL_UNDERGRADUATE = ['First-Year Student', 'Sophomore', 'Junior', 'Senior'];

  it('uses the filter when the prose is silent on years', () => {
    expect(
      yearOfStudyFor({
        brief: 'The fellowship funds independent summer research.',
        eligibility: 'Applicants must be in good academic standing.',
        yearOfStudy: ['Sophomore', 'Junior'],
      }),
    ).toEqual(['Sophomore', 'Junior']);
  });

  it('prefers the years the prose names over a filter that contradicts them', () => {
    expect(
      yearOfStudyFor({
        brief: 'Awarded to a Yale undergraduate for a project of research.',
        eligibility: 'Freshman, Sophomores &amp; Juniors.',
        yearOfStudy: ALL_UNDERGRADUATE,
      }),
    ).toEqual(['First-Year Student', 'Sophomore', 'Junior']);
  });

  it('drops a year the prose excludes', () => {
    expect(
      yearOfStudyFor({
        brief: 'The fellowship funds independent summer research.',
        eligibility: 'Seniors are not eligible.',
        yearOfStudy: ALL_UNDERGRADUATE,
      }),
    ).toEqual(['First-Year Student', 'Sophomore', 'Junior']);
  });

  it('emits no year of study when the prose admits a level the vocabulary cannot name', () => {
    const fund = parseFundDetailPage(
      fundDetailHtml({
        brief: 'The fellowship funds independent summer research.',
        eligibility:
          'Fellowships are ordinarily awarded to juniors, but first years, sophomores and graduate affiliates are eligible.',
        yearOfStudy: ['First-Year Student', 'Sophomore', 'Junior'],
      }),
      { title: '', url: FUND_A_URL },
    )!;

    expect(fund.yearOfStudy).toEqual([]);
    expect(fundToObservations(fund).map((obs) => obs.field)).not.toContain('yearOfStudy');
  });

  it('lets the filter refine a generic level the prose names, and widens a level it omits', () => {
    expect(
      yearOfStudyFor({
        brief: 'The fellowship supports Yale undergraduates who plan summer research projects.',
        eligibility: '',
        yearOfStudy: ['First-Year Student', 'Sophomore', 'Junior'],
      }),
    ).toEqual(['First-Year Student', 'Sophomore', 'Junior']);
    expect(
      yearOfStudyFor({
        brief:
          'The award is available to Yale graduate and professional school students and undergraduate students.',
        eligibility: '',
        yearOfStudy: ['Master’s Student', 'PhD Pre-Candidacy'],
      }),
    ).toEqual([...ALL_UNDERGRADUATE, 'Master’s Student', 'PhD Pre-Candidacy', 'JD', 'MD']);
  });

  it('admits a whole level the prose quantifies', () => {
    expect(
      yearOfStudyFor({
        brief: 'Any graduate or undergraduate student currently enrolled at Yale may apply.',
        eligibility: '',
        yearOfStudy: ['First-Year Student', 'Sophomore', 'Junior'],
      }),
    ).toEqual([
      ...ALL_UNDERGRADUATE,
      'Master’s Student',
      'PhD Pre-Candidacy',
      'PhD Post-Candidacy',
    ]);
  });

  it('reads "rising" years as the current year below and a range as every year in it', () => {
    expect(
      yearOfStudyFor({
        brief:
          'Applications are welcomed from rising sophomores through rising seniors who wish to do research.',
        eligibility: '',
        yearOfStudy: ALL_UNDERGRADUATE,
      }),
    ).toEqual(['First-Year Student', 'Sophomore', 'Junior']);
  });

  it('does not read a senior essay or a fellow track as eligibility, and lets a preference add', () => {
    expect(
      yearOfStudyFor({
        brief:
          'The grants are intended for seniors to support their senior essays. A strong preference will be given to juniors. Fellows join the Junior Director track.',
        eligibility: '',
        yearOfStudy: ['Sophomore', 'Junior', 'Senior'],
      }),
    ).toEqual(['Junior', 'Senior']);
  });

  it('does not read a program a student will enter or an organization name as a year', () => {
    expect(
      yearOfStudyFor({
        brief:
          'Eligible candidates must be planning to attend a graduate program in public service.',
        eligibility:
          'Research must take place in the region defined by the Association of Yale Alumni.',
        yearOfStudy: ['Junior'],
      }),
    ).toEqual(['Junior']);
  });

  it('adds an exception to the years the filter lists', () => {
    expect(
      yearOfStudyFor({
        brief: 'The fellowship funds summer journalism internships.',
        eligibility: 'Graduating seniors may also be considered on a case-by-case basis.',
        yearOfStudy: ['Sophomore', 'Junior'],
      }),
    ).toEqual(['Sophomore', 'Junior', 'Senior']);
  });

  it('does not read a negated relative clause or a qualified refusal as an exclusion', () => {
    expect(
      yearOfStudyFor({
        brief:
          'This award is designed for Yale undergraduate students who are not enrolled in the seminar.',
        eligibility: 'Seniors may not apply for this fellowship to be used after their graduation.',
        yearOfStudy: ALL_UNDERGRADUATE,
      }),
    ).toEqual(ALL_UNDERGRADUATE);
  });
});

describe('createRenderedStudentGrantsHtmlFetcher', () => {
  it('returns no HTML for a rendered 404 page the bridge does not flag as blocked', async () => {
    const renderedFetcher = vi.fn().mockResolvedValue({
      url: FUND_B_URL,
      html: '<html><body><h1>Page not found</h1></body></html>',
      statusCode: 404,
      blocked: false,
      fetchMode: 'scrapling',
    });
    const fetchHtml = createRenderedStudentGrantsHtmlFetcher(renderedFetcher);

    await expect(fetchHtml(FUND_B_URL, false, STUDENT_GRANTS_DATABASE_SOURCE)).resolves.toBe('');
    expect(renderedFetcher).toHaveBeenCalledWith(expect.objectContaining({ mode: 'stealthy' }));
  });
});

describe('createStudentGrantsDetailFetcher', () => {
  it('reads a fund page through the stealthy renderer when one is configured', async () => {
    const rendered = vi.fn(async () => FUND_A_DETAIL_HTML);
    const staticFetch = vi.fn(async () => '');
    const fetchDetail = createStudentGrantsDetailFetcher(rendered, staticFetch);

    await expect(fetchDetail(FUND_A_URL, false, STUDENT_GRANTS_DATABASE_SOURCE)).resolves.toBe(
      FUND_A_DETAIL_HTML,
    );
    expect(staticFetch).not.toHaveBeenCalled();
  });

  it('falls back to the static fetch when the renderer returns no usable page', async () => {
    const staticFetch = vi.fn(async () => FUND_A_DETAIL_HTML);
    const fetchDetail = createStudentGrantsDetailFetcher(
      vi.fn(async () => ''),
      staticFetch,
    );

    await expect(fetchDetail(FUND_A_URL, false, STUDENT_GRANTS_DATABASE_SOURCE)).resolves.toBe(
      FUND_A_DETAIL_HTML,
    );
  });

  it('uses the static fetch alone when no renderer is configured', async () => {
    const staticFetch = vi.fn(async () => FUND_A_DETAIL_HTML);
    const fetchDetail = createStudentGrantsDetailFetcher(null, staticFetch);

    await expect(fetchDetail(FUND_A_URL, false, STUDENT_GRANTS_DATABASE_SOURCE)).resolves.toBe(
      FUND_A_DETAIL_HTML,
    );
  });
});

describe('StudentGrantsDatabaseScraper.run', () => {
  it('reads the fund pages the catalog cites when the search grid does not render', async () => {
    const searchFetcher = vi.fn(async () => '');
    const detailFetcher = vi.fn(async (url: string) =>
      url === FUND_A_URL ? FUND_A_DETAIL_HTML : '',
    );
    const scraper = new StudentGrantsDatabaseScraper({
      searchFetcher,
      detailFetcher,
      gridEnumerator: null,
      loadSeedUrls: async () => [FUND_A_URL],
    });
    const { ctx, emitted } = makeContext();

    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(1);
    expect(emitted.find((obs) => obs.field === 'title')?.value).toBe(
      'Fixture Summer Research Fellowship',
    );
    expect(detailFetcher).toHaveBeenCalledWith(FUND_A_URL, false, STUDENT_GRANTS_DATABASE_SOURCE);
  });

  it('emits nothing when neither the grid nor any cited fund page yields a fund', async () => {
    const scraper = new StudentGrantsDatabaseScraper({
      searchFetcher: vi.fn(async () => ''),
      detailFetcher: vi.fn(async () => AUTH_SHELL_HTML),
      gridEnumerator: null,
      loadSeedUrls: async () => [FUND_B_URL],
    });
    const { ctx, emitted } = makeContext();

    const result = await scraper.run(ctx);

    expect(result.observationCount).toBe(0);
    expect(emitted).toHaveLength(0);
  });

  it('reads each fund once whether the grid or a citation found it', async () => {
    const detailFetcher = vi.fn(async (url: string) =>
      url === FUND_A_URL ? FUND_A_DETAIL_HTML : AUTH_SHELL_HTML,
    );
    const scraper = new StudentGrantsDatabaseScraper({
      searchFetcher: vi.fn(async () => SEARCH_RESULTS_HTML),
      detailFetcher,
      loadSeedUrls: async () => [FUND_A_URL],
    });
    const { ctx } = makeContext();

    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(1);
    expect(detailFetcher.mock.calls.map(([url]) => url).sort()).toEqual(
      [FUND_A_URL, FUND_B_URL].sort(),
    );
  });

  it('reads only the funds an entity-scoped run names', async () => {
    const detailFetcher = vi.fn(async (_url: string) => FUND_A_DETAIL_HTML);
    const scraper = new StudentGrantsDatabaseScraper({
      searchFetcher: vi.fn(async () => ''),
      detailFetcher,
      gridEnumerator: null,
      loadSeedUrls: async () => [FUND_A_URL, FUND_B_URL],
    });
    const { ctx } = makeContext({ only: [sourceKeyForFund(FUND_B_URL)] });

    await scraper.run(ctx);

    expect(detailFetcher.mock.calls.map(([url]) => url)).toEqual([FUND_B_URL]);
  });

  const ROW_FUND_URL =
    'https://yale.communityforce.com/Funds/FundDetails.aspx?5A5A5A5A5A5A5A5A5A5A5A5A5A5A';
  const KNOWN_ROW: FundSearchGridRow = {
    eventTarget: 'ctl00$PreContent$GrantsSearch1$grdFund$ctl02$lnkFundName',
    name: 'Fixture Summer Research Fellowship',
  };
  const NEW_ROW: FundSearchGridRow = {
    eventTarget: 'ctl00$PreContent$GrantsSearch1$grdFund$ctl03$lnkFundName',
    name: 'Fixture Postback Fellowship',
  };

  function fakeGrid(
    rows: FundSearchGridRow[],
    resolve: (row: FundSearchGridRow) => Promise<string | null>,
    overrides: Partial<FundSearchGrid> = {},
  ) {
    const resolveRowFundUrl = vi.fn(resolve);
    const grid: FundSearchGrid = {
      html: '<html><body></body></html>',
      url: DEFAULT_STUDENT_GRANTS_SEARCH_URL,
      rows,
      pageCount: 1,
      resolveRowFundUrl,
      ...overrides,
    };
    return { gridEnumerator: vi.fn(async () => grid), resolveRowFundUrl };
  }

  const postbackDetailHtml = FUND_A_DETAIL_HTML.replace(
    'Fixture Summer Research Fellowship',
    'Fixture Postback Fellowship',
  );

  it('enumerates the grid by postback when no renderer is configured', async () => {
    const { gridEnumerator, resolveRowFundUrl } = fakeGrid([NEW_ROW], async () => ROW_FUND_URL);
    const detailFetcher = vi.fn(async (url: string) =>
      url === ROW_FUND_URL ? postbackDetailHtml : '',
    );
    const scraper = new StudentGrantsDatabaseScraper({
      searchFetcher: createRenderedStudentGrantsHtmlFetcher(null),
      detailFetcher,
      gridEnumerator,
      loadSeedUrls: async () => [],
    });
    const { ctx, emitted } = makeContext();

    const result = await scraper.run(ctx);

    expect(gridEnumerator).toHaveBeenCalledTimes(1);
    expect(resolveRowFundUrl).toHaveBeenCalledWith(NEW_ROW);
    expect(result.entitiesObserved).toBe(1);
    expect(result.partialFailures).toBeUndefined();
    expect(emitted.find((obs) => obs.field === 'sourceKey')?.value).toBe(
      sourceKeyForFund(ROW_FUND_URL),
    );
  });

  it('keeps the rendered grid as the first choice and never posts back when it renders', async () => {
    const { gridEnumerator } = fakeGrid([NEW_ROW], async () => ROW_FUND_URL);
    const scraper = new StudentGrantsDatabaseScraper({
      searchFetcher: vi.fn(async () => SEARCH_RESULTS_HTML),
      detailFetcher: vi.fn(async () => FUND_A_DETAIL_HTML),
      gridEnumerator,
      loadSeedUrls: async () => [],
    });

    await scraper.run(makeContext().ctx);

    expect(gridEnumerator).not.toHaveBeenCalled();
  });

  it('skips the postback for a row whose fund page was already read, and rereads no known url', async () => {
    const OTHER_ROW: FundSearchGridRow = {
      eventTarget: 'ctl00$PreContent$GrantsSearch1$grdFund$ctl04$lnkFundName',
      name: 'Fixture Renamed Listing',
    };
    const { gridEnumerator, resolveRowFundUrl } = fakeGrid(
      [KNOWN_ROW, NEW_ROW, OTHER_ROW],
      async (row) => (row === OTHER_ROW ? FUND_A_URL : ROW_FUND_URL),
    );
    const detailFetcher = vi.fn(async (url: string) =>
      url === FUND_A_URL ? FUND_A_DETAIL_HTML : postbackDetailHtml,
    );
    const scraper = new StudentGrantsDatabaseScraper({
      searchFetcher: vi.fn(async () => ''),
      detailFetcher,
      gridEnumerator,
      loadSeedUrls: async () => [FUND_A_URL],
    });

    const result = await scraper.run(makeContext().ctx);

    expect(resolveRowFundUrl.mock.calls.map(([row]) => row)).toEqual([NEW_ROW, OTHER_ROW]);
    expect(detailFetcher.mock.calls.map(([url]) => url)).toEqual([FUND_A_URL, ROW_FUND_URL]);
    expect(result.entitiesObserved).toBe(2);
    expect(result.notes).toContain('postbackSkippedKnown=2');
  });

  it('reports a failed grid as a partial failure and still reads the cited funds', async () => {
    const gridEnumerator = vi.fn(async (): Promise<FundSearchGrid> => {
      throw new Error('Request failed with status code 503');
    });
    const scraper = new StudentGrantsDatabaseScraper({
      searchFetcher: vi.fn(async () => ''),
      detailFetcher: vi.fn(async () => FUND_A_DETAIL_HTML),
      gridEnumerator,
      loadSeedUrls: async () => [FUND_A_URL],
    });

    const result = await scraper.run(makeContext().ctx);

    expect(result.entitiesObserved).toBe(1);
    expect(result.partialFailures).toEqual([
      'fund search grid unavailable: Request failed with status code 503',
    ]);
  });

  it('never reports success over a grid that lists no funds', async () => {
    const { gridEnumerator } = fakeGrid([], async () => null);
    const scraper = new StudentGrantsDatabaseScraper({
      searchFetcher: vi.fn(async () => ''),
      detailFetcher: vi.fn(async () => ''),
      gridEnumerator,
      loadSeedUrls: async () => [],
    });

    const result = await scraper.run(makeContext().ctx);

    expect(result.entitiesObserved).toBe(0);
    expect(result.partialFailures).toEqual([
      'fund search grid listed no funds; read cited fund pages only',
    ]);
  });

  it('reports rows that do not resolve, and stops posting back after repeated failures', async () => {
    const rows = Array.from({ length: 8 }, (_unused, index) => ({
      eventTarget: `ctl00$PreContent$GrantsSearch1$grdFund$ctl1${index}$lnkFundName`,
      name: `Fixture Unresolved Fund ${index}`,
    }));
    const { gridEnumerator, resolveRowFundUrl } = fakeGrid(rows, async () => {
      throw new Error('socket hang up');
    });
    const scraper = new StudentGrantsDatabaseScraper({
      searchFetcher: vi.fn(async () => ''),
      detailFetcher: vi.fn(async () => ''),
      gridEnumerator,
      loadSeedUrls: async () => [],
    });

    const result = await scraper.run(makeContext().ctx);

    expect(resolveRowFundUrl).toHaveBeenCalledTimes(5);
    expect(result.partialFailures).toEqual([
      '8 of 8 fund search rows did not resolve to a fund page (3 abandoned after 5 consecutive failures)',
    ]);
  });

  it('never enumerates the grid in a run scoped with --only', async () => {
    const { gridEnumerator } = fakeGrid([NEW_ROW], async () => ROW_FUND_URL);
    const detailFetcher = vi.fn(async (_url: string) => FUND_A_DETAIL_HTML);
    const scraper = new StudentGrantsDatabaseScraper({
      searchFetcher: vi.fn(async () => ''),
      detailFetcher,
      gridEnumerator,
      loadSeedUrls: async () => [FUND_A_URL],
    });

    const result = await scraper.run(makeContext({ only: [sourceKeyForFund(FUND_A_URL)] }).ctx);

    expect(gridEnumerator).not.toHaveBeenCalled();
    expect(detailFetcher.mock.calls.map(([url]) => url)).toEqual([FUND_A_URL]);
    expect(result.partialFailures).toBeUndefined();
  });

  it('never enumerates the grid during a benchmark capture', async () => {
    const { gridEnumerator } = fakeGrid([NEW_ROW], async () => ROW_FUND_URL);
    const scraper = new StudentGrantsDatabaseScraper({
      searchFetcher: vi.fn(async () => ''),
      detailFetcher: vi.fn(async () => FUND_A_DETAIL_HTML),
      gridEnumerator,
      loadSeedUrls: async () => [FUND_A_URL],
    });

    beginBenchmarkCapture();
    try {
      await scraper.run(makeContext().ctx);
    } finally {
      finishBenchmarkCapture();
    }

    expect(gridEnumerator).not.toHaveBeenCalled();
  });
});

describe('the fields a fund page states it has none of (#4230)', () => {
  const absenceClaimFor = (options: Parameters<typeof fundDetailHtml>[0]) => {
    const fund = parseFundDetailPage(fundDetailHtml(options), { title: '', url: FUND_A_URL })!;
    const observations = fundToObservations(fund);
    const witness = observations.find((obs) => obs.field === 'sourceKey');
    return {
      claim: witness?.assertsNoValueFor ?? [],
      fields: observations.map((obs) => obs.field),
      carriers: observations.filter((obs) => obs.assertsNoValueFor).map((obs) => obs.field),
    };
  };

  it('states no application link when the page routes applications elsewhere and links nowhere', () => {
    const { claim, fields, carriers } = absenceClaimFor({
      brief:
        'Applications for these fellowships will be accepted via the Fixture Summer Research Common Application.',
      yearOfStudy: ['Junior'],
    });

    expect(claim).toEqual(['applicationLink']);
    expect(fields).not.toContain('applicationLink');
    expect(carriers).toEqual(['sourceKey']);
  });

  it('states no year of study when the prose names a level the vocabulary cannot express', () => {
    const { claim, fields } = absenceClaimFor({
      brief: 'The fellowship funds independent summer research.',
      eligibility:
        'Fellowships are ordinarily awarded to juniors, but first years, sophomores and graduate affiliates are eligible.',
      yearOfStudy: ['First-Year Student', 'Sophomore', 'Junior'],
    });

    expect(claim).toEqual(['yearOfStudy']);
    expect(fields).not.toContain('yearOfStudy');
  });

  it('states nothing about a field it read a value for', () => {
    const { claim, fields } = absenceClaimFor({
      brief: 'The fellowship funds independent summer research.',
      eligibility: 'Juniors may apply.',
      yearOfStudy: ['Junior'],
    });

    expect(claim).toEqual([]);
    expect(fields).toContain('applicationLink');
    expect(fields).toContain('yearOfStudy');
  });

  it('states nothing when the prose is silent and the filter lists no year', () => {
    const { claim } = absenceClaimFor({
      brief: 'The fellowship funds independent summer research.',
      eligibility: 'Applicants must be in good academic standing.',
      yearOfStudy: [],
    });

    expect(claim).toEqual([]);
  });

  it('claims nothing at all when the page could not be parsed as a fund', () => {
    expect(parseFundDetailPage(AUTH_SHELL_HTML, { title: 'Anything', url: FUND_A_URL })).toBeNull();
  });
});

const TWO_CYCLE_APPLICATION_INFORMATION =
  'The program accepts applications two times during the year. The <span style="font-weight: bold;">fall term deadline is Thursday July 30, 2026</span>, and the <span style="font-weight: bold;">spring term deadline is Monday January 4, 2027</span>. Letters of recommendation are due January 11, 2027.';

describe('a later cycle the fund prose states (#4171)', () => {
  const twoCycleFund = (referenceDate: Date) =>
    parseFundDetailPage(
      fundDetailHtml({
        opens: '6/05/2026',
        deadline: '7/30/2026 5:00 PM',
        applicationInformation: TWO_CYCLE_APPLICATION_INFORMATION,
      }),
      { title: '', url: FUND_A_URL },
      referenceDate,
    )!;

  it('plans the next stated cycle once the structured deadline has passed', () => {
    const fund = twoCycleFund(new Date('2026-10-03T12:00:00Z'));

    expect(fund.deadline?.toISOString()).toBe('2027-01-05T04:59:59.999Z');
    expect(fund.applicationOpenDate).toBeUndefined();
    expect(fund.isAcceptingApplications).toBe(true);
  });

  it('keeps the structured window while its deadline is still ahead', () => {
    const fund = twoCycleFund(new Date('2026-07-01T12:00:00Z'));

    expect(fund.deadline?.toISOString()).toBe('2026-07-30T21:00:00.000Z');
    expect(fund.applicationOpenDate?.toISOString()).toBe('2026-06-05T04:00:00.000Z');
  });

  it('never reads a date another step is due by as an application cycle', () => {
    const fund = twoCycleFund(new Date('2027-01-06T12:00:00Z'));

    expect(fund.deadline?.toISOString()).toBe('2027-01-05T04:59:59.999Z');
  });

  it('never moves a deadline earlier than the structured one', () => {
    const fund = parseFundDetailPage(
      fundDetailHtml({
        opens: '6/05/2026',
        deadline: '7/30/2026 5:00 PM',
        applicationInformation: 'The priority deadline is June 30, 2026.',
      }),
      { title: '', url: FUND_A_URL },
      new Date('2026-10-03T12:00:00Z'),
    )!;

    expect(fund.deadline?.toISOString()).toBe('2026-07-30T21:00:00.000Z');
  });
});

const FUND_NOT_AVAILABLE_HTML = `
  <html><head><title>Yale Student Grants and Fellowships - Landing Page</title></head><body>
    <nav><a href="/Login.aspx">Login</a></nav>
    <div class="content"><span id="ctl00_PreContent_lblMessage">This fund is no longer available.</span></div>
  </body></html>
`;

describe('a fund the portal says is no longer available (#4174)', () => {
  it('reads the notice page as a retired fund, and neither a login shell nor a fund page as one', () => {
    expect(isRetiredFundPage(FUND_NOT_AVAILABLE_HTML)).toBe(true);
    expect(isRetiredFundPage(AUTH_SHELL_HTML)).toBe(false);
    expect(isRetiredFundPage(FUND_A_DETAIL_HTML)).toBe(false);
    expect(
      isRetiredFundPage(
        fundDetailHtml({ applicationInformation: 'This fund is no longer available.' }),
      ),
    ).toBe(false);
  });

  it('retires the program the fund page keys, and only that', async () => {
    const scraper = new StudentGrantsDatabaseScraper({
      searchFetcher: vi.fn(async () => ''),
      detailFetcher: vi.fn(async () => FUND_NOT_AVAILABLE_HTML),
      gridEnumerator: null,
      loadSeedUrls: async () => [FUND_B_URL],
    });
    const { ctx, emitted } = makeContext();

    const result = await scraper.run(ctx);

    expect(emitted).toEqual([
      expect.objectContaining({
        entityType: 'fellowship',
        entityKey: sourceKeyForFund(FUND_B_URL),
        sourceUrl: FUND_B_URL,
        field: 'archived',
        value: true,
      }),
    ]);
    expect(result.entitiesObserved).toBe(0);
    expect(result.notes).toContain('retired=1');
  });

  it('still emits nothing for a login shell or a failed fetch', async () => {
    for (const html of [AUTH_SHELL_HTML, '']) {
      const scraper = new StudentGrantsDatabaseScraper({
        searchFetcher: vi.fn(async () => ''),
        detailFetcher: vi.fn(async () => html),
        gridEnumerator: null,
        loadSeedUrls: async () => [FUND_B_URL],
      });
      const { ctx, emitted } = makeContext();

      const result = await scraper.run(ctx);

      expect(emitted).toEqual([]);
      expect(result.notes).toContain('retired=0');
    }
  });
});
