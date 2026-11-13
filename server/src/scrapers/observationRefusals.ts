export interface ObservationRefusedValue {
  field: string;
  value: string;
  reason: string;
  classifier: string;
  classifierVersion: number;
}

export interface ObservationClassifierAdmission {
  classifier: string;
  version: number;
}

const MAX_LABEL_LENGTH = 120;
const MAX_VALUE_LENGTH = 2048;

function boundedLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_LABEL_LENGTH ? trimmed : undefined;
}

function positiveVersion(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function sanitizeRefusedValues(entries: unknown): ObservationRefusedValue[] {
  if (!Array.isArray(entries)) return [];
  const kept = new Map<string, ObservationRefusedValue>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    const field = boundedLabel(candidate.field);
    const reason = boundedLabel(candidate.reason);
    const classifier = boundedLabel(candidate.classifier);
    const classifierVersion = positiveVersion(candidate.classifierVersion);
    const value = typeof candidate.value === 'string' ? candidate.value.trim() : '';
    if (!field || !reason || !classifier || !classifierVersion) continue;
    if (!value || value.length > MAX_VALUE_LENGTH) continue;
    const refusal = { field, value, reason, classifier, classifierVersion };
    kept.set(JSON.stringify(refusal), refusal);
  }
  return [...kept.values()];
}

export function sanitizeClassifierAdmissions(entries: unknown): ObservationClassifierAdmission[] {
  if (!Array.isArray(entries)) return [];
  const latestByClassifier = new Map<string, number>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    const classifier = boundedLabel(candidate.classifier);
    const version = positiveVersion(candidate.version);
    if (!classifier || !version) continue;
    latestByClassifier.set(classifier, Math.max(version, latestByClassifier.get(classifier) ?? 0));
  }
  return [...latestByClassifier].map(([classifier, version]) => ({ classifier, version }));
}

export function admittedClassifierVersion(
  admissions: readonly ObservationClassifierAdmission[] | undefined,
  classifier: string,
): number {
  let version = 0;
  for (const admission of admissions ?? []) {
    if (admission.classifier === classifier) version = Math.max(version, admission.version);
  }
  return version;
}
