export interface HostPause {
  host: string;
  until: Date;
}

export class HostPausedError extends Error {
  constructor(
    readonly pause: HostPause,
    readonly requestSent = false,
  ) {
    super(
      `${pause.host} is pausing this run's requests until ${pause.until.toISOString()} after refusing them; the run comes back to it then.`,
    );
    this.name = 'HostPausedError';
  }
}
