export const PROGRAM_APPLICATION_STAGE_LABELS = [
  'Saved',
  'Preparing',
  'Applied',
  'Awarded',
  'Not selected',
  'No longer applying',
];

const STAGE_BY_LABEL = {
  Saved: 'SAVED',
  Preparing: 'PREPARING',
  Applied: 'APPLIED',
  Awarded: 'AWARDED',
  'Not selected': 'NOT_SELECTED',
  'No longer applying': 'CLOSED',
};

const LEGACY_STAGE_PROGRAM = {
  _id: 'e2e-stage-program-legacy',
  title: 'Quokka Legacy Stage Fellowship',
  stage: 'CONTACTED',
  storedLabel: 'Contacted',
};

const STAGED_PROGRAM = {
  _id: 'e2e-stage-program-active',
  title: 'Quokka Field Study Fellowship',
  stage: 'SAVED',
};

const syntheticWatchedProgram = ({ _id, title }, daysUntilDeadline) => ({
  _id,
  title,
  summary: 'Synthetic program for the application stage smoke.',
  description: 'Synthetic program description for the application stage smoke.',
  programCategory: 'FELLOWSHIP',
  programKind: 'RESEARCH_FUNDING',
  isAcceptingApplications: true,
  deadline: new Date(Date.now() + daysUntilDeadline * 86400000).toISOString(),
  yearOfStudy: ['Junior'],
  purpose: ['Research'],
});

const servedPlans = (plans) =>
  Object.fromEntries(
    Object.entries(plans).map(([id, plan]) => [
      id,
      { stage: plan.stage, privateNotes: '', updatedAt: plan.updatedAt },
    ]),
  );

const routeSyntheticWatchedPrograms = async (context, session) => {
  const programs = [
    syntheticWatchedProgram(STAGED_PROGRAM, 5),
    syntheticWatchedProgram(LEGACY_STAGE_PROGRAM, 9),
  ];
  const plans = {
    [STAGED_PROGRAM._id]: { stage: STAGED_PROGRAM.stage, updatedAt: new Date(0).toISOString() },
    [LEGACY_STAGE_PROGRAM._id]: {
      stage: LEGACY_STAGE_PROGRAM.stage,
      updatedAt: new Date(0).toISOString(),
    },
  };
  const stageWrites = [];
  await context.route('**/api/**', (route) => route.fulfill({ json: {} }));
  await context.route('**/api/check', (route) => route.fulfill({ json: session }));
  await context.route('**/api/analytics/**', (route) => route.fulfill({ status: 204 }));
  await context.route('**/api/users/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/users/watchedProgramIds')) {
      return route.fulfill({ json: { watchedProgramIds: programs.map((program) => program._id) } });
    }
    if (pathname.endsWith('/users/watchedPrograms')) {
      return route.fulfill({ json: { watchedPrograms: programs } });
    }
    if (pathname.endsWith('/users/watchedProgramPlans')) {
      return route.fulfill({ json: { watchedProgramPlans: servedPlans(plans) } });
    }
    const planWrite = pathname.match(/\/users\/watchedProgramPlans\/([^/]+)$/);
    if (planWrite && request.method() === 'PUT') {
      const programId = decodeURIComponent(planWrite[1]);
      const stage = request.postDataJSON()?.data?.plan?.stage;
      if (stage) {
        stageWrites.push({ programId, stage });
        plans[programId] = { stage, updatedAt: new Date(Date.now()).toISOString() };
      }
      return route.fulfill({ json: { watchedProgramPlans: servedPlans(plans) } });
    }
    return route.fulfill({
      json: {
        savedResearchEntities: [],
        unavailableSavedResearchEntities: [],
        savedResearchEntityIds: [],
        savedResearchEntityPlans: {},
      },
    });
  });
  return { stageWrites, plans };
};

const waitForWrite = async (stagePage, stageWrites, count) => {
  const deadline = Date.now() + 10000;
  while (stageWrites.length < count && Date.now() < deadline) {
    await stagePage.waitForTimeout(50);
  }
};

const optionLabels = (select) =>
  select.evaluate((element) => Array.from(element.options, (option) => option.textContent.trim()));

const selectedLabel = (select) =>
  select.evaluate((element) => element.options[element.selectedIndex]?.textContent.trim());

export const assertWatchedProgramApplicationStages = async ({
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
      const { stageWrites, plans } = await routeSyntheticWatchedPrograms(context, session);
      const stagePage = await context.newPage();
      await withFailureContextOf(stagePage, async () => {
        await stagePage.goto(`${baseUrl}/dashboard?tab=programs`, {
          waitUntil: 'domcontentloaded',
        });
        const control = stagePage.getByRole('combobox', {
          name: `Application stage for ${STAGED_PROGRAM.title}`,
        });
        await control.waitFor({ timeout: 20000 });
        const card = stagePage.getByRole('listitem').filter({ has: control });
        const legacyControl = stagePage.getByRole('combobox', {
          name: `Application stage for ${LEGACY_STAGE_PROGRAM.title}`,
        });

        const offered = await optionLabels(control);
        assert(
          JSON.stringify(offered) === JSON.stringify(PROGRAM_APPLICATION_STAGE_LABELS),
          `A program card offered ${JSON.stringify(offered)} at ${at}, not the application stages.`,
        );
        assert(
          (await selectedLabel(legacyControl)) === LEGACY_STAGE_PROGRAM.storedLabel,
          `A program plan stored at ${LEGACY_STAGE_PROGRAM.stage} did not render its stored stage selected at ${at}.`,
        );
        assert(
          (await stagePage.getByRole('combobox', { name: /^Outreach stage for / }).count()) === 0,
          `A program card still labels its control as an outreach stage at ${at}.`,
        );

        const box = await control.boundingBox();
        assert(
          box && box.height >= 44,
          `The application stage control is ${box?.height}px tall at ${at}, under the 44px target.`,
        );
        await control.focus();
        assert(
          await control.evaluate((element) => element === element.ownerDocument.activeElement),
          `The application stage control cannot take keyboard focus at ${at}.`,
        );

        for (const label of PROGRAM_APPLICATION_STAGE_LABELS.slice(1)) {
          const stage = STAGE_BY_LABEL[label];
          const writesBefore = stageWrites.length;
          await control.selectOption({ label });
          await waitForWrite(stagePage, stageWrites, writesBefore + 1);
          await card
            .getByRole('status')
            .filter({ hasText: /^Saved$/ })
            .waitFor({ timeout: 10000 });
          const write = stageWrites[writesBefore];
          assert(
            write?.programId === STAGED_PROGRAM._id && write.stage === stage,
            `Choosing ${label} at ${at} wrote ${JSON.stringify(write)} instead of ${stage}.`,
          );
          assert(
            (await selectedLabel(control)) === label,
            `The control shows ${await selectedLabel(control)} after choosing ${label} at ${at}.`,
          );
          if (stage === 'AWARDED' || stage === 'NOT_SELECTED') {
            await screenshot(`program-application-stage-${stage.toLowerCase()}-${at}`, stagePage);
          }
        }

        await stagePage.reload({ waitUntil: 'domcontentloaded' });
        await control.waitFor({ timeout: 20000 });
        assert(
          (await selectedLabel(control)) === 'No longer applying' &&
            plans[STAGED_PROGRAM._id].stage === 'CLOSED',
          `The last application stage did not survive a reload at ${at}.`,
        );
        record('program application stages', {
          width: viewport.width,
          writes: stageWrites.map((write) => write.stage),
        });
      });
    } finally {
      await context.close();
    }
  }
};
