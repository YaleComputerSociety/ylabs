import type { CapturedPage } from './snapshotBenchmarkMode';

export interface CaptureMode {
  kind: 'capture';
  pages: Map<string, CapturedPage>;
  requested: Set<string>;
  requestInterceptorId: number;
  responseInterceptorId: number;
}

export interface ReplayMode {
  kind: 'replay';
  pages: Map<string, unknown>;
  served: Set<string>;
  missed: Set<string>;
  networkBlocks: number;
  interceptorId: number;
  liveModel: boolean;
}

export let mode: CaptureMode | ReplayMode | null = null;

export function setBenchmarkMode(next: CaptureMode | ReplayMode | null): void {
  mode = next;
}

export const isBenchmarkReplayActive = (): boolean => mode?.kind === 'replay';

export const isBenchmarkModeActive = (): boolean => mode !== null;

export const isLiveModelReplayActive = (): boolean => mode?.kind === 'replay' && mode.liveModel;
