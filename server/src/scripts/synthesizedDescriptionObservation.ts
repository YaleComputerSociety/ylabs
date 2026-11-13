import { appendObservations, type ObservationDropGuard } from '../scrapers/observationStore';
import type { ObservationInput } from '../scrapers/types';

export type AppendDescriptionObservations = (
  inputs: ObservationInput[],
  context: Parameters<typeof appendObservations>[1],
  opts?: { reportDrops?: (droppedBy: Partial<Record<ObservationDropGuard, number>>) => void },
) => Promise<{ inserted: number }>;

export interface SynthesizedDescriptionWriteReport {
  written: boolean;
  observationDropped?: boolean;
  observationDroppedBy?: string[];
}

export async function appendSynthesizedDescription(
  report: SynthesizedDescriptionWriteReport,
  observation: ObservationInput,
  context: Parameters<typeof appendObservations>[1],
  append: AppendDescriptionObservations = appendObservations,
): Promise<boolean> {
  let droppedBy: Partial<Record<ObservationDropGuard, number>> = {};
  const appended = await append([observation], context, {
    reportDrops: (counts) => {
      droppedBy = counts;
    },
  });
  if (appended.inserted < 1) {
    report.observationDropped = true;
    const guards = Object.keys(droppedBy) as ObservationDropGuard[];
    report.observationDroppedBy = guards.length > 0 ? guards : ['unreported'];
    return false;
  }
  report.written = true;
  return true;
}
