import { appendObservations } from '../scrapers/observationStore';
import type { ObservationInput } from '../scrapers/types';

export type AppendDescriptionObservations = (
  inputs: ObservationInput[],
  context: Parameters<typeof appendObservations>[1],
) => Promise<{ inserted: number }>;

export interface SynthesizedDescriptionWriteReport {
  written: boolean;
  observationDropped?: boolean;
}

export async function appendSynthesizedDescription(
  report: SynthesizedDescriptionWriteReport,
  observation: ObservationInput,
  context: Parameters<typeof appendObservations>[1],
  append: AppendDescriptionObservations = appendObservations,
): Promise<boolean> {
  const appended = await append([observation], context);
  if (appended.inserted < 1) {
    report.observationDropped = true;
    return false;
  }
  report.written = true;
  return true;
}
