export type ReplayCleanupStatus =
  | 'CURRENT_MATCH'
  | 'SCRAPER_ALREADY_FIXED'
  | 'SCRAPER_STILL_BAD'
  | 'MATERIALIZED_STALE'
  | 'NEEDS_REVIEW';

export interface ObservationReplayCandidate {
  observationId: string;
  entityType: string;
  entityId?: string;
  entityKey?: string;
  field: string;
  value: unknown;
  sourceName: string;
  sourceUrl?: string;
  observedAt?: string;
  confidence?: number;
}

export interface PreviewObservation {
  entityType: string;
  entityId?: string;
  entityKey?: string;
  field: string;
  value: unknown;
  sourceName: string;
  sourceUrl?: string;
}

export interface RematerializeTarget {
  entityType: string;
  entityId?: string;
  entityKey?: string;
}

export interface FieldCleanupTarget extends RematerializeTarget {
  field: string;
  staleValue: unknown;
}

export interface ObservationQualityRule {
  id: string;
  appliesTo(candidate: ObservationReplayCandidate): boolean;
  isBad(candidate: ObservationReplayCandidate): boolean;
  fixHint: string;
  currentMissingMeansFixed?: boolean;
}

export interface ReplayClassificationInput {
  candidate: ObservationReplayCandidate;
  currentObservations: PreviewObservation[];
  rules: ObservationQualityRule[];
  materializedValue?: unknown;
}

export interface ReplayClassificationResult {
  observationId: string;
  status: ReplayCleanupStatus;
  ruleIds: string[];
  reason: string;
  fixHint?: string;
  supersedeObservationIds: string[];
  rematerializeTargets: RematerializeTarget[];
  fieldCleanupTargets: FieldCleanupTarget[];
  acceptedForApply: boolean;
}

export const defaultObservationQualityRules: ObservationQualityRule[] = [
  {
    id: 'dept-roster-research-entity-description',
    appliesTo(candidate) {
      return (
        candidate.sourceName === 'dept-faculty-roster' &&
        isResearchEntityDescriptionField(candidate)
      );
    },
    isBad() {
      return true;
    },
    currentMissingMeansFixed: true,
    fixHint:
      'Current department roster scraper should no longer emit research-entity descriptions; keep profile prose on User records or source-backed lab microsite observations.',
  },
  {
    id: 'research-entity-description-profile-bio',
    appliesTo(candidate) {
      return isResearchEntityDescriptionField(candidate);
    },
    isBad(candidate) {
      const text = normalizeText(candidate.value);
      return (
        text.includes(' is a professor ') ||
        text.includes(' is an associate professor ') ||
        text.includes(' is an assistant professor ') ||
        text.includes(' is a lecturer ') ||
        text.startsWith('professor ')
      );
    },
    fixHint:
      'Current description scraper still emits profile biography or appointment text; tighten description extraction before applying cleanup.',
  },
  {
    id: 'centers-faculty-research-area-title-description',
    appliesTo(candidate) {
      return (
        candidate.sourceName === 'centers-institutes-index' &&
        candidate.entityType === 'researchEntity' &&
        candidate.field === 'shortDescription' &&
        String(candidate.entityKey || '').startsWith('faculty-research-area-')
      );
    },
    isBad(candidate) {
      const text = normalizeText(candidate.value);
      return (
        /^((assistant|associate|clinical|adjunct|emeritus|sterling|john c\. malone)\s+)*professor\b/.test(text) ||
        /\bprofessor of\b/.test(text) ||
        /^faculty member\b/.test(text) ||
        /\bdirector\b/.test(text)
      );
    },
    currentMissingMeansFixed: true,
    fixHint:
      'Current centers/institutes scraper should not emit member titles as faculty-research-area descriptions; keep titles on member/person context.',
  },
  {
    id: 'lab-microsite-cancer-center-generated-faculty-description-chrome',
    appliesTo(candidate) {
      return (
        candidate.sourceName === 'lab-microsite-description-llm' &&
        isResearchEntityDescriptionField(candidate) &&
        String(candidate.entityKey || '').startsWith('faculty-research-area-')
      );
    },
    isBad(candidate) {
      return isCancerCenterPageChrome(candidate.value);
    },
    currentMissingMeansFixed: true,
    fixHint:
      'Current lab microsite description scraper rejects Cancer Center profile chrome and no longer targets generated faculty-research-area shell rows.',
  },
  {
    id: 'lab-microsite-cancer-center-generated-faculty-profile-fragment',
    appliesTo(candidate) {
      return (
        candidate.sourceName === 'lab-microsite-description-llm' &&
        isResearchEntityDescriptionField(candidate) &&
        String(candidate.entityKey || '').startsWith('faculty-research-area-') &&
        normalizeText(candidate.sourceUrl).includes('/cancer/profile/')
      );
    },
    isBad(candidate) {
      return isCancerCenterProfileDescriptionFragment(candidate.value);
    },
    currentMissingMeansFixed: true,
    fixHint:
      'Current lab microsite description scraper rejects Yale Medicine profile callouts and no longer targets generated Cancer Center faculty-research-area shell rows.',
  },
  {
    id: 'research-entity-description-page-chrome',
    appliesTo(candidate) {
      return isResearchEntityDescriptionField(candidate);
    },
    isBad(candidate) {
      const text = normalizeText(candidate.value);
      return (
        text.includes('information for students faculty staff') ||
        text.includes('skip to main content') ||
        isCancerCenterPageChrome(candidate.value) ||
        isCancerCenterProfileDescriptionFragment(candidate.value) ||
        text.includes('community outreachcommunity advisory boardprograms') ||
        text.includes('patient informationcancer types')
      );
    },
    fixHint:
      'Current description scraper still emits page chrome; tighten source text extraction before applying cleanup.',
  },
  {
    id: 'research-entity-description-recruitment-boilerplate',
    appliesTo(candidate) {
      return isResearchEntityDescriptionField(candidate);
    },
    isBad(candidate) {
      const text = normalizeText(candidate.value);
      return (
        text.includes('looking for motivated postdocs') ||
        text.includes('graduate students to join our team')
      );
    },
    fixHint:
      'Current description scraper still emits recruitment boilerplate as lab description; reject recruitment-only text before applying cleanup.',
  },
  {
    id: 'protocol-less-source-url',
    appliesTo(candidate) {
      return Boolean(candidate.sourceUrl) || candidate.field.toLowerCase().includes('url');
    },
    isBad(candidate) {
      const values = Array.isArray(candidate.value)
        ? [...candidate.value, candidate.sourceUrl]
        : [candidate.value, candidate.sourceUrl];
      return values.some(
        (value) => typeof value === 'string' && /^[-a-z0-9.]+\.yale\.edu\//i.test(value),
      );
    },
    fixHint:
      'Current scraper still emits protocol-less URLs; normalize to https URLs before applying cleanup.',
  },
  {
    id: 'invalid-source-url',
    appliesTo(candidate) {
      return Boolean(candidate.sourceUrl);
    },
    isBad(candidate) {
      if (!candidate.sourceUrl) return false;
      try {
        const parsed = new URL(candidate.sourceUrl);
        return parsed.protocol !== 'http:' && parsed.protocol !== 'https:';
      } catch {
        return true;
      }
    },
    fixHint:
      'Current scraper still emits an invalid source URL; normalize or reject source URLs before applying cleanup.',
  },
  {
    id: 'undergrad-access-postgraduate-role',
    appliesTo(candidate) {
      return (
        candidate.sourceName === 'lab-microsite-undergrad-llm' &&
        candidate.entityType === 'researchEntity' &&
        [
          'undergradAccessEvidence',
          'undergradEvidenceQuote',
          'undergradRoleEvidenceQuote',
        ].includes(candidate.field)
      );
    },
    isBad(candidate) {
      const text = evidenceQuoteText(candidate.value);
      return /postgraduate\s+associate/.test(text) && !/\bundergraduate\b/.test(text);
    },
    currentMissingMeansFixed: true,
    fixHint:
      'Current undergrad-access scraper should not classify postgraduate associates as undergraduate access evidence.',
  },
];

export function classifyObservationReplayCandidate(
  input: ReplayClassificationInput,
): ReplayClassificationResult {
  const matchedRules = input.rules.filter(
    (rule) => rule.appliesTo(input.candidate) && rule.isBad(input.candidate),
  );
  const comparable = input.currentObservations.filter((observation) =>
    isComparableObservation(input.candidate, observation),
  );
  const currentMatch = comparable.some((observation) =>
    sameObservationValue(observation.value, input.candidate.value),
  );
  const currentBad = comparable.some((observation) =>
    matchedRules.some((rule) =>
      rule.isBad({
        ...input.candidate,
        value: observation.value,
        sourceUrl: observation.sourceUrl,
      }),
    ),
  );
  const target = rematerializeTargetForCandidate(input.candidate);

  if (currentMatch && matchedRules.length === 0) {
    return buildResult(
      input.candidate,
      'CURRENT_MATCH',
      [],
      'Current scraper output matches an acceptable active observation.',
      [],
    );
  }

  if (currentMatch && matchedRules.length > 0) {
    return buildResult(
      input.candidate,
      'SCRAPER_STILL_BAD',
      matchedRules,
      'Current scraper still emits the same bad observation value.',
      [],
    );
  }

  if (currentBad) {
    return buildResult(
      input.candidate,
      'SCRAPER_STILL_BAD',
      matchedRules,
      'Current scraper emits a different value that still violates the same quality rule.',
      [],
    );
  }

  if (matchedRules.length > 0 && comparable.length > 0) {
    return buildResult(
      input.candidate,
      'SCRAPER_ALREADY_FIXED',
      matchedRules,
      'Old observation violates a quality rule, and current scraper emits comparable clean evidence.',
      target ? [target] : [],
      [input.candidate.observationId],
    );
  }

  if (
    matchedRules.length > 0 &&
    comparable.length === 0 &&
    matchedRules.some((rule) => rule.currentMissingMeansFixed)
  ) {
    const fieldCleanupTarget = fieldCleanupTargetForCandidate(input.candidate);
    return buildResult(
      input.candidate,
      'SCRAPER_ALREADY_FIXED',
      matchedRules,
      'Old observation violates a quality rule, and current scraper no longer emits that field.',
      fieldCleanupTarget ? [fieldCleanupTarget] : target ? [target] : [],
      [input.candidate.observationId],
      fieldCleanupTarget ? [fieldCleanupTarget] : [],
    );
  }

  if (
    input.materializedValue !== undefined &&
    !sameObservationValue(input.materializedValue, input.candidate.value) &&
    comparable.some((observation) => sameObservationValue(observation.value, input.materializedValue))
  ) {
    return buildResult(
      input.candidate,
      'MATERIALIZED_STALE',
      [],
      'Active observations are acceptable, but the materialized field does not reflect current evidence.',
      target ? [target] : [],
    );
  }

  return buildResult(
    input.candidate,
    'NEEDS_REVIEW',
    matchedRules,
    comparable.length === 0
      ? 'No comparable current observation was emitted by the scraper preview.'
      : 'Candidate could not be safely classified automatically.',
    [],
  );
}

export function isComparableObservation(
  candidate: ObservationReplayCandidate,
  observation: PreviewObservation,
): boolean {
  return (
    candidate.entityType === observation.entityType &&
    candidate.field === observation.field &&
    candidate.sourceName === observation.sourceName &&
    normalizeIdentifier(candidate.entityId) === normalizeIdentifier(observation.entityId) &&
    normalizeIdentifier(candidate.entityKey) === normalizeIdentifier(observation.entityKey)
  );
}

export function sameObservationValue(left: unknown, right: unknown): boolean {
  return stableValue(left) === stableValue(right);
}

function buildResult(
  candidate: ObservationReplayCandidate,
  status: ReplayCleanupStatus,
  rules: ObservationQualityRule[],
  reason: string,
  rematerializeTargets: RematerializeTarget[],
  supersedeObservationIds: string[] = [],
  fieldCleanupTargets: FieldCleanupTarget[] = [],
): ReplayClassificationResult {
  return {
    observationId: candidate.observationId,
    status,
    ruleIds: rules.map((rule) => rule.id),
    reason,
    fixHint: rules[0]?.fixHint,
    supersedeObservationIds,
    rematerializeTargets,
    fieldCleanupTargets,
    acceptedForApply: false,
  };
}

function isResearchEntityDescriptionField(candidate: ObservationReplayCandidate): boolean {
  return (
    candidate.entityType === 'researchEntity' &&
    ['description', 'shortDescription', 'fullDescription'].includes(candidate.field)
  );
}

function rematerializeTargetForCandidate(
  candidate: ObservationReplayCandidate,
): RematerializeTarget | undefined {
  if (!candidate.entityId && !candidate.entityKey) return undefined;
  return {
    entityType: candidate.entityType,
    entityId: candidate.entityId,
    entityKey: candidate.entityKey,
  };
}

function fieldCleanupTargetForCandidate(
  candidate: ObservationReplayCandidate,
): FieldCleanupTarget | undefined {
  const target = rematerializeTargetForCandidate(candidate);
  if (!target) return undefined;
  return {
    ...target,
    field: candidate.field,
    staleValue: candidate.value,
  };
}

function normalizeIdentifier(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function compactText(value: unknown): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '');
}

function isCancerCenterPageChrome(value: unknown): boolean {
  const compact = compactText(value);
  return [
    'administrationncidesignationhistory',
    'communityoutreachcommunityadvisoryboardprograms',
    'patientinformationcancertypes',
    'bythenumbersinformationresourcesresearchtrainingmeetourteam',
  ].some((fragment) => compact.includes(fragment));
}

function isCancerCenterProfileDescriptionFragment(value: unknown): boolean {
  const text = normalizeText(value);
  const compact = compactText(value);
  return (
    compact.includes('viewdoctorprofileadditionaltitles') ||
    compact.includes('viewthisdoctorsclinicalprofile') ||
    /^dr[.,]\s+(?:using|with|in|and)\b/i.test(text)
  );
}

function searchableText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return normalizeText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(searchableText).join(' ');
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).map(searchableText).join(' ');
  }
  return normalizeText(value);
}

function evidenceQuoteText(value: unknown): string {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const objectValue = value as Record<string, unknown>;
    return [
      objectValue.evidenceQuote,
      objectValue.quote,
      objectValue.undergradEvidenceQuote,
      objectValue.undergradRoleEvidenceQuote,
    ]
      .map(searchableText)
      .join(' ');
  }
  return searchableText(value);
}

function stableValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(normalizeText(value));
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).sort().join(',')}]`;
  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValue(objectValue[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(String(value));
}
