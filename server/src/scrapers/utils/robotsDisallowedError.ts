/**
 * A request our own code refused before sending because the host's robots.txt disallows the
 * path (#6213). Like a host pause it observed nothing about the page, so no lane may read it as
 * a verdict, and `isRefusedBeforeSending` lists it. It imports nothing, so `httpFetch.ts` can
 * name it without a cycle through the robots reader.
 */
export class RobotsDisallowedError extends Error {
  readonly requestSent = false;

  constructor(
    readonly host: string,
    readonly path: string,
  ) {
    super(
      `${host} disallows ${path} for this crawler in its robots.txt; the request was not sent.`,
    );
    this.name = 'RobotsDisallowedError';
  }
}
