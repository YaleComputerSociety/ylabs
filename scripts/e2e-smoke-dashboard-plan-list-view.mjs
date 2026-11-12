const DAY_MS = 86400000;

const SYNTHETIC_RESEARCH_PLANS = [
  {
    slug: 'e2e-plan-view-quokka-lab',
    name: 'Quokka Signals Lab',
    stage: 'CONTACTED',
    savedDaysAgo: 40,
  },
  { slug: 'e2e-plan-view-wombat-lab', name: 'Wombat Imaging Lab', stage: 'SAVED', savedDaysAgo: 2 },
  {
    slug: 'e2e-plan-view-numbat-lab',
    name: 'Numbat Ecology Lab',
    stage: 'APPLIED',
    savedDaysAgo: 12,
  },
  {
    slug: 'e2e-plan-view-bilby-lab',
    name: 'Bilby Robotics Lab',
    stage: 'EXPLORING',
    savedDaysAgo: 25,
  },
  {
    slug: 'e2e-plan-view-dingo-lab',
    name: 'Dingo Language Lab',
    stage: 'CLOSED',
    savedDaysAgo: 60,
  },
];

const NEWEST_RESEARCH_ORDER = [
  'e2e-plan-view-wombat-lab',
  'e2e-plan-view-numbat-lab',
  'e2e-plan-view-bilby-lab',
  'e2e-plan-view-quokka-lab',
  'e2e-plan-view-dingo-lab',
];

const STAGE_RESEARCH_ORDER = [
  'e2e-plan-view-wombat-lab',
  'e2e-plan-view-bilby-lab',
  'e2e-plan-view-quokka-lab',
  'e2e-plan-view-numbat-lab',
  'e2e-plan-view-dingo-lab',
];

const WAITING_RESEARCH_ORDER = ['e2e-plan-view-numbat-lab', 'e2e-plan-view-quokka-lab'];

const SYNTHETIC_PROGRAMS = [
  {
    _id: 'e2e-plan-view-program-a',
    title: 'Quokka Field Grant',
    stage: 'APPLIED',
    savedDaysAgo: 30,
    dueInDays: 20,
  },
  {
    _id: 'e2e-plan-view-program-b',
    title: 'Wombat Travel Award',
    stage: 'SAVED',
    savedDaysAgo: 1,
    dueInDays: 90,
  },
  {
    _id: 'e2e-plan-view-program-c',
    title: 'Numbat Thesis Fellowship',
    stage: 'PREPARING',
    savedDaysAgo: 10,
    dueInDays: 6,
  },
];

const isoDaysFromNow = (days) => new Date(Date.now() + days * DAY_MS).toISOString();

const syntheticResearchEntity = ({ slug, name }) => ({
  _id: `id-${slug}`,
  slug,
  name,
  kind: 'lab',
  departments: ['Synthetic Department'],
  school: 'Synthetic School',
  shortDescription: 'Synthetic research for the plan list smoke.',
});

const syntheticProgram = ({ _id, title, dueInDays }) => ({
  _id,
  title,
  summary: 'Synthetic program for the plan list smoke.',
  description: 'Synthetic program description for the plan list smoke.',
  programCategory: 'FELLOWSHIP',
  programKind: 'RESEARCH_FUNDING',
  isAcceptingApplications: true,
  deadline: isoDaysFromNow(dueInDays),
  yearOfStudy: ['Junior'],
  purpose: ['Research'],
});

const servedPlan = ({ stage, savedDaysAgo }) => {
  const createdAt = isoDaysFromNow(-savedDaysAgo);
  return { stage, privateNotes: '', createdAt, updatedAt: createdAt };
};

export const routeSyntheticPlans = async (context, session) => {
  const researchPlans = Object.fromEntries(
    SYNTHETIC_RESEARCH_PLANS.map((plan) => [`id-${plan.slug}`, servedPlan(plan)]),
  );
  const programPlans = Object.fromEntries(
    SYNTHETIC_PROGRAMS.map((program) => [program._id, servedPlan(program)]),
  );
  await context.route('**/api/**', (route) => route.fulfill({ json: {} }));
  await context.route('**/api/check', (route) => route.fulfill({ json: session }));
  await context.route('**/api/analytics/**', (route) => route.fulfill({ status: 204 }));
  await context.route('**/api/users/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/users/savedResearchEntityIds')) {
      return route.fulfill({
        json: { savedResearchEntityIds: SYNTHETIC_RESEARCH_PLANS.map((plan) => plan.slug) },
      });
    }
    if (pathname.endsWith('/users/savedResearchEntities')) {
      return route.fulfill({
        json: {
          savedResearchEntities: SYNTHETIC_RESEARCH_PLANS.map(syntheticResearchEntity),
          unavailableSavedResearchEntities: [],
        },
      });
    }
    if (pathname.endsWith('/users/savedResearchEntityPlans')) {
      return route.fulfill({ json: { savedResearchEntityPlans: researchPlans } });
    }
    if (pathname.endsWith('/users/watchedProgramIds')) {
      return route.fulfill({
        json: { watchedProgramIds: SYNTHETIC_PROGRAMS.map((program) => program._id) },
      });
    }
    if (pathname.endsWith('/users/watchedPrograms')) {
      return route.fulfill({ json: { watchedPrograms: SYNTHETIC_PROGRAMS.map(syntheticProgram) } });
    }
    if (pathname.endsWith('/users/watchedProgramPlans')) {
      return route.fulfill({ json: { watchedProgramPlans: programPlans } });
    }
    return route.fulfill({ json: {} });
  });
};

const researchOrder = (page) =>
  page
    .getByRole('tabpanel', { name: /^Saved research/ })
    .getByRole('link', { name: 'Open' })
    .evaluateAll((links) =>
      links.map((link) => link.getAttribute('href').replace('/research/', '')),
    );

const programOrder = (page) =>
  page
    .getByRole('combobox', { name: /^Application stage for / })
    .evaluateAll((selects) =>
      selects.map((select) =>
        select.getAttribute('aria-label').replace('Application stage for ', ''),
      ),
    );

const searchOf = (page) => new URL(page.url()).search;

const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const settledValue = async (read, isSettled, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!isSettled(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    value = await read();
  }
  return value;
};

const settledOrder = (read, expected) => settledValue(read, (value) => sameList(value, expected));

const stageChip = (panel, name) => panel.getByRole('radio', { name });

const stageChipLabel = (panel, inputId) => panel.locator(`label[for="${inputId}"]`);

const pageOverflowsSideways = (page) =>
  page.evaluate(() => {
    const scroller = document.querySelector('[data-scroll-container]');
    const docWidth = document.documentElement.scrollWidth;
    return (
      docWidth > window.innerWidth || (scroller && scroller.scrollWidth > scroller.clientWidth)
    );
  });

export const assertDashboardPlanListView = async ({
  browser,
  baseUrl,
  session,
  viewports,
  assert,
  record,
  screenshot,
  withFailureContextOf,
}) => {
  for (const viewport of viewports) {
    const at = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    try {
      await routeSyntheticPlans(context, session);
      const page = await context.newPage();
      await withFailureContextOf(page, async () => {
        await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
        const research = page.getByRole('tabpanel', { name: /^Saved research/ });
        const sort = research.getByRole('combobox', { name: 'Sort by' });
        await sort.waitFor({ timeout: 20000 });

        const defaultOrder = await researchOrder(page);
        assert(
          sameList(defaultOrder, NEWEST_RESEARCH_ORDER),
          `Saved research did not open newest saved first at ${at}: ${JSON.stringify(defaultOrder)}.`,
        );
        assert(
          (await sort.inputValue()) === 'recent',
          `The saved research sort did not default to Recently saved at ${at}.`,
        );
        const chipBox = await stageChipLabel(
          research,
          'saved-research-plans-stage-waiting',
        ).boundingBox();
        assert(
          chipBox && chipBox.height >= 44,
          `A stage filter option is ${chipBox?.height}px tall at ${at}, under the 44px target.`,
        );
        const sortBox = await sort.boundingBox();
        assert(
          sortBox && sortBox.height >= 44,
          `The sort control is ${sortBox?.height}px tall at ${at}, under the 44px target.`,
        );
        assert(
          !(await pageOverflowsSideways(page)),
          `The plan list controls make the dashboard scroll sideways at ${at}.`,
        );

        await stageChipLabel(research, 'saved-research-plans-stage-waiting').click();
        await page.waitForURL(/stage=waiting/);
        const waitingOrder = await settledOrder(() => researchOrder(page), WAITING_RESEARCH_ORDER);
        assert(
          sameList(waitingOrder, WAITING_RESEARCH_ORDER),
          `Waiting to hear back showed ${JSON.stringify(waitingOrder)} at ${at}.`,
        );
        assert(
          (await research
            .getByRole('status')
            .filter({ hasText: 'Showing 2 of 5 saved research plans: Waiting to hear back' })
            .count()) === 1,
          `The filtered result count is not announced at ${at}.`,
        );
        await screenshot(`dashboard-plan-list-waiting-${at}`, page);

        await sort.selectOption('stage');
        await page.waitForURL(/sort=stage/);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await sort.waitFor({ timeout: 20000 });
        assert(
          (await stageChip(research, 'Waiting to hear back (2)').isChecked()) &&
            (await sort.inputValue()) === 'stage',
          `The stage filter and sort did not survive a reload at ${at} (${searchOf(page)}).`,
        );

        await stageChip(research, 'Waiting to hear back (2)').focus();
        await page.keyboard.press('ArrowRight');
        await page.waitForURL(/stage=saved/);
        assert(
          await settledValue(() => stageChip(research, 'Saved (1)').isChecked(), Boolean),
          `An arrow key did not move the stage filter to the next option at ${at}.`,
        );

        await page.goto(`${baseUrl}/dashboard?stage=preparing&sort=stage`, {
          waitUntil: 'domcontentloaded',
        });
        const showAll = research.getByRole('button', { name: 'Show all' });
        await showAll.waitFor({ timeout: 20000 });
        assert(
          (await research
            .getByRole('heading', { name: 'No saved research plans at Preparing' })
            .count()) === 1,
          `A filter that matches nothing did not explain itself at ${at}.`,
        );
        await screenshot(`dashboard-plan-list-empty-filter-${at}`, page);
        await showAll.click();
        await page.waitForFunction(() => !new URL(location.href).searchParams.has('stage'));
        const allChip = stageChip(research, 'All (5)');
        await page.waitForFunction(
          () => document.activeElement?.id === 'saved-research-plans-stage-all',
        );
        const stageOrder = await settledOrder(() => researchOrder(page), STAGE_RESEARCH_ORDER);
        assert(
          (await allChip.isChecked()) && stageOrder.length === 5,
          `Show all did not return every plan at ${at}: ${JSON.stringify(stageOrder)}.`,
        );
        assert(
          sameList(stageOrder, STAGE_RESEARCH_ORDER),
          `Sorting by stage gave ${JSON.stringify(stageOrder)} at ${at}.`,
        );

        await page.goto(`${baseUrl}/dashboard?stage=bogus&sort=deadline`, {
          waitUntil: 'domcontentloaded',
        });
        await sort.waitFor({ timeout: 20000 });
        assert(
          (await stageChip(research, 'All (5)').isChecked()) &&
            (await sort.inputValue()) === 'recent',
          `Invalid stage and sort values did not fall back to the default at ${at}.`,
        );

        await page.goto(`${baseUrl}/dashboard?stage=waiting`, { waitUntil: 'domcontentloaded' });
        await sort.waitFor({ timeout: 20000 });
        await page.getByRole('tab', { name: /^Watched programs/ }).click();
        await page.waitForURL((url) => url.searchParams.get('tab') === 'programs');
        assert(
          !new URL(page.url()).searchParams.has('stage'),
          `Switching tabs kept the saved research filter in the URL at ${at}.`,
        );
        const programs = page.getByRole('tabpanel', { name: /^Watched programs/ });
        const programSort = programs.getByRole('combobox', { name: 'Sort by' });
        await programSort.waitFor({ timeout: 20000 });
        const programDefault = await programOrder(page);
        assert(
          programDefault[0] === 'Wombat Travel Award',
          `Watched programs did not open newest watched first at ${at}: ${JSON.stringify(programDefault)}.`,
        );
        await programSort.selectOption('deadline');
        await page.waitForURL(/sort=deadline/);
        const byDeadline = await settledValue(
          () => programOrder(page),
          (order) => order[0] === 'Numbat Thesis Fellowship',
        );
        assert(
          byDeadline[0] === 'Numbat Thesis Fellowship',
          `The deadline sort did not put the soonest deadline first at ${at}: ${JSON.stringify(byDeadline)}.`,
        );
        assert(
          (await programs.getByRole('radio', { name: /^Contacted/ }).count()) === 0,
          `Watched programs offer a Contacted filter at ${at}.`,
        );
        await stageChipLabel(programs, 'watched-programs-stage-waiting').click();
        await page.waitForURL(/stage=waiting/);
        const programWaiting = await settledOrder(() => programOrder(page), ['Quokka Field Grant']);
        assert(
          sameList(programWaiting, ['Quokka Field Grant']),
          `Watched programs waiting to hear back showed ${JSON.stringify(programWaiting)} at ${at}.`,
        );
        assert(
          !(await pageOverflowsSideways(page)),
          `The watched program controls make the dashboard scroll sideways at ${at}.`,
        );
        await screenshot(`dashboard-plan-list-programs-waiting-${at}`, page);

        record('dashboard plan list view', {
          width: viewport.width,
          defaultOrder,
          waitingOrder,
          programWaiting,
        });
      });
    } finally {
      await context.close();
    }
  }
};
