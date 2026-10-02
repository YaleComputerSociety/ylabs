import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { OrgUnit } from '../../models/orgUnit';
import { Signal } from '../../models/signal';
import { listDepartmentCourseCreditRoutes } from '../../services/departmentResearchContextService';
import {
  ORG_UNIT_COURSE_CREDIT_ROUTE_FIELD,
  materializeOrgUnitSignalsForObservations,
} from '../orgUnitSignalMaterializer';

let memoryServer: MongoMemoryServer | undefined;

const DEPARTMENT = 'Synthetic Studies';
const SLUG = 'synthetic-studies';
const SOURCE_URL = 'https://synthetic.yale.edu/undergraduate/senior-essay';

const observation = (value: Record<string, unknown>) => ({
  field: ORG_UNIT_COURSE_CREDIT_ROUTE_FIELD,
  sourceName: 'department-undergrad-research',
  sourceUrl: SOURCE_URL,
  observedAt: new Date('2026-10-01T00:00:00.000Z'),
  value,
});

const routeObservation = observation({
  schemaVersion: 1,
  evidenceQuote: 'Seniors receive course credit for the senior essay by enrolling in SYNT 4910.',
  supportingQuoteCount: 1,
});

const absenceObservation = observation({ schemaVersion: 1, routeStated: false });

describe('withdrawing a department course-credit route over a real store', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('course_credit_route_withdrawal_test'));
    await Signal.syncIndexes();
  });

  beforeEach(async () => {
    await Signal.collection.deleteMany({});
    await OrgUnit.collection.deleteMany({});
    await OrgUnit.create({ slug: SLUG, name: DEPARTMENT, kind: 'DEPARTMENT' });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('stops serving a route once the lane reports its pages state none', async () => {
    await materializeOrgUnitSignalsForObservations({
      orgUnitSlug: SLUG,
      observations: [routeObservation],
    });
    await expect(listDepartmentCourseCreditRoutes([DEPARTMENT])).resolves.toHaveLength(1);

    const result = await materializeOrgUnitSignalsForObservations({
      orgUnitSlug: SLUG,
      observations: [absenceObservation],
    });

    expect(result).toMatchObject({ signalsWritten: 0, signalsWithdrawn: 1, rejected: 0 });
    await expect(listDepartmentCourseCreditRoutes([DEPARTMENT])).resolves.toEqual([]);
  });

  it('counts the withdrawal on a dry run without archiving the route', async () => {
    await materializeOrgUnitSignalsForObservations({
      orgUnitSlug: SLUG,
      observations: [routeObservation],
    });

    const result = await materializeOrgUnitSignalsForObservations({
      orgUnitSlug: SLUG,
      observations: [absenceObservation],
      dryRun: true,
    });

    expect(result.signalsWithdrawn).toBe(1);
    await expect(listDepartmentCourseCreditRoutes([DEPARTMENT])).resolves.toHaveLength(1);
  });

  it('serves the route again when a later read states one', async () => {
    await materializeOrgUnitSignalsForObservations({
      orgUnitSlug: SLUG,
      observations: [absenceObservation],
    });
    await materializeOrgUnitSignalsForObservations({
      orgUnitSlug: SLUG,
      observations: [routeObservation],
    });

    const routes = await listDepartmentCourseCreditRoutes([DEPARTMENT]);
    expect(routes).toHaveLength(1);
    expect(routes[0].evidenceQuote).toContain('SYNT 4910');
  });
});
