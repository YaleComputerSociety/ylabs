import { Fellowship } from '../models/fellowship';
import { DUPLICATE_PROGRAM_COPY_INPUT_FIELDS } from '../services/studentVisibilityGateService';
import { PROGRAM_STUDENT_VISIBILITY_INPUT_FIELDS } from '../services/studentVisibilityTier';
import { parseOnlyFieldsList } from './userMaterializerFieldScope';

export const PROGRAM_MATERIALIZER_SCOPE_FIELDS: readonly string[] = [
  'additionalInformation',
  'applicationInformation',
  'applicationLink',
  'applicationMaterials',
  'applicationOpenDate',
  'awardAmount',
  'bestNextStep',
  'citizenshipStatus',
  'compensationSummary',
  'competitionType',
  'contactEmail',
  'contactName',
  'contactOffice',
  'contactPhone',
  'deadline',
  'description',
  'eligibility',
  'entryMode',
  'fullSourceDescription',
  'globalRegions',
  'hoursPerWeek',
  'isAcceptingApplications',
  'links',
  'mentorMatching',
  'prepSteps',
  'programCategory',
  'programDates',
  'programKind',
  'programRole',
  'purpose',
  'requiresMentorBeforeApply',
  'researchFocused',
  'restrictionsToUseOfAward',
  'sourceLastChangedAt',
  'sourceLastVerifiedAt',
  'sourcePageTitle',
  'sourceUrl',
  'studentFacingCategory',
  'summary',
  'termOfAward',
  'title',
  'undergraduateOnly',
  'yaleCollegeOnly',
  'yearOfStudy',
];

export const PROGRAM_MATERIALIZER_DENIED_FIELDS: Readonly<Record<string, string>> = {
  _id: 'document bookkeeping',
  __v: 'document bookkeeping',
  createdAt: 'document bookkeeping',
  updatedAt: 'document bookkeeping',
  sourceKey: 'row identity',
  sourceName: 'row identity',
  sourceFingerprint: 'row identity',
  archived: 'retirement, decided by the run reconciliation this scope skips',
  audited: 'operator state',
  favorites: 'engagement',
  views: 'engagement',
  sourceLinkHealth: 'written by the link-health probe, not an observation',
  upcomingDuplicateWindow: 'derived by the visibility gate',
  studentVisibilityComputedAt: 'visibility gate output',
  studentVisibilityComputedTier: 'visibility gate output',
  studentVisibilityEvaluatedAt: 'visibility gate output',
  studentVisibilityReasons: 'visibility gate output',
  studentVisibilitySuppressionReason: 'visibility gate output',
  studentVisibilityTier: 'visibility gate output',
  studentVisibilityOverrideTier: 'operator review',
  studentVisibilityReviewedAt: 'operator review',
  studentVisibilityReviewedByAccountId: 'operator review',
  studentVisibilityReviewedByNetid: 'operator review',
};

export function unclassifiedFellowshipSchemaPaths(): string[] {
  const classified = new Set([
    ...PROGRAM_MATERIALIZER_SCOPE_FIELDS,
    ...Object.keys(PROGRAM_MATERIALIZER_DENIED_FIELDS),
  ]);
  return Object.keys(Fellowship.schema.paths)
    .filter((path) => !classified.has(path))
    .sort();
}

export function parseProgramOnlyFieldsList(value: string | undefined): string[] {
  const known = new Set(PROGRAM_MATERIALIZER_SCOPE_FIELDS);
  return parseOnlyFieldsList(value, {
    flag: '--only-program-fields',
    canonical: (field) => (known.has(field) ? field : undefined),
    supported: PROGRAM_MATERIALIZER_SCOPE_FIELDS,
  });
}

export const PROGRAM_REGATE_TRIGGER_FIELDS: ReadonlySet<string> = new Set([
  ...PROGRAM_STUDENT_VISIBILITY_INPUT_FIELDS,
  ...DUPLICATE_PROGRAM_COPY_INPUT_FIELDS,
]);

export function programFieldScopeRegateFields(fields: readonly string[]): string[] {
  return fields.filter((field) => PROGRAM_REGATE_TRIGGER_FIELDS.has(field));
}
