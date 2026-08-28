const SWEEP_STAGE_DISABLE_VALUES = new Set(['0', 'false', 'no', 'n', 'off', 'disable', 'disabled']);
const SWEEP_STAGE_ENABLE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on', 'enable', 'enabled']);

const normalizeSweepStageFlag = (rawValue: string | undefined): string =>
  (rawValue || '').trim().toLowerCase();

export function isSweepStageOptedIn(rawValue: string | undefined): boolean {
  return SWEEP_STAGE_ENABLE_VALUES.has(normalizeSweepStageFlag(rawValue));
}

export function isSweepStageEnabledByDefault(rawValue: string | undefined): boolean {
  return !SWEEP_STAGE_DISABLE_VALUES.has(normalizeSweepStageFlag(rawValue));
}
