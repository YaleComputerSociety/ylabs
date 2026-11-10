import type express from 'express';
import passport from 'passport';
import {
  CasMalformedResponseError,
  CasTicketRejectedError,
  CasUnreachableError,
} from './casCallbackFailure';

const CAS_TICKET_PARAM = 'ticket';
const CAS_SERVICE_PARAM = 'service';
const CAS1_ACCEPTED = 'yes';
const CAS1_REFUSED = 'no';
const CAS_RENEW_PARAM = 'renew';
const CAS_RENEW_VALUE = 'true';

export const CAS_REAUTH_PARAM = 'reauth';
export const CAS_REAUTH_VALUE = '1';

export type CasLogin = { user: string };

export type CasVerifyDone = (
  err: unknown,
  user?: Express.User | false | null,
  info?: object,
) => void;

export type CasVerify = (login: CasLogin, done: CasVerifyDone) => void;

export type CasStrategyOptions = {
  ssoBaseURL: string;
  serverBaseURL?: string;
  validationTimeoutMs: number;
};

export const presentedCasTicket = (req: express.Request): string | undefined => {
  const ticket = (req.query as Record<string, unknown> | undefined)?.[CAS_TICKET_PARAM];
  return typeof ticket === 'string' && ticket.length > 0 ? ticket : undefined;
};

/**
 * A sign-in that asks CAS for fresh credentials rather than an existing single sign-on
 * session. The flag rides in our own URL, so it is part of the `service` both legs send,
 * and a callback cannot claim it for a ticket CAS issued without it.
 */
export const requestsCasReauthentication = (req: express.Request): boolean =>
  (req.query as Record<string, unknown> | undefined)?.[CAS_REAUTH_PARAM] === CAS_REAUTH_VALUE;

const withoutTrailingSlashes = (value: string): string => value.replace(/\/+$/, '');

const requestOrigin = (req: express.Request): string => `${req.protocol}://${req.host}`;

export const casServiceUrl = (req: express.Request, serverBaseURL?: string): string => {
  const requested = new URL(req.originalUrl, 'http://service.invalid');
  const service = new URL(serverBaseURL || requestOrigin(req));
  const params = new URLSearchParams(requested.search);
  params.delete(CAS_TICKET_PARAM);
  service.pathname = requested.pathname;
  service.search = params.toString();
  service.hash = '';
  return service.href;
};

export const casLoginUrl = (ssoBaseURL: string, service: string, renew = false): string => {
  const login = new URL(`${withoutTrailingSlashes(ssoBaseURL)}/login`);
  const params = new URLSearchParams({ [CAS_SERVICE_PARAM]: service });
  if (renew) params.set(CAS_RENEW_PARAM, CAS_RENEW_VALUE);
  login.search = params.toString();
  return login.href;
};

export const casValidateUrl = (
  ssoBaseURL: string,
  ticket: string,
  service: string,
  renew = false,
): string => {
  const validate = new URL(`${withoutTrailingSlashes(ssoBaseURL)}/validate`);
  const params = new URLSearchParams({
    [CAS_TICKET_PARAM]: ticket,
    [CAS_SERVICE_PARAM]: service,
  });
  if (renew) params.set(CAS_RENEW_PARAM, CAS_RENEW_VALUE);
  validate.search = params.toString();
  return validate.href;
};

export const parseCas1ValidationResponse = (body: string): CasLogin => {
  const lines = body.split(/\r?\n/);
  if (lines[0] === CAS1_REFUSED) throw new CasTicketRejectedError();
  if (lines[0] === CAS1_ACCEPTED && lines.length >= 2) return { user: lines[1] };
  throw new CasMalformedResponseError();
};

const describeTransportFailure = (error: unknown): string =>
  error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'request failed';

export async function validateCas1Ticket(
  ssoBaseURL: string,
  ticket: string,
  service: string,
  timeoutMs: number,
  renew = false,
): Promise<CasLogin> {
  let body: string;
  try {
    const response = await fetch(casValidateUrl(ssoBaseURL, ticket, service, renew), {
      headers: { accept: 'text/plain' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new CasUnreachableError(`HTTP ${response.status}`);
    }
    body = await response.text();
  } catch (error) {
    if (error instanceof CasUnreachableError) throw error;
    throw new CasUnreachableError(describeTransportFailure(error), { cause: error });
  }
  return parseCas1ValidationResponse(body);
}

export class CasStrategy extends passport.Strategy {
  readonly name = 'cas';
  private readonly ssoBaseURL: string;
  private readonly serverBaseURL?: string;
  private readonly validationTimeoutMs: number;
  private readonly verify: CasVerify;

  constructor(options: CasStrategyOptions, verify: CasVerify) {
    super();
    this.ssoBaseURL = withoutTrailingSlashes(options.ssoBaseURL);
    this.serverBaseURL = options.serverBaseURL || undefined;
    this.validationTimeoutMs = options.validationTimeoutMs;
    this.verify = verify;
  }

  authenticate(req: express.Request): void {
    const service = casServiceUrl(req, this.serverBaseURL);
    const ticket = presentedCasTicket(req);
    const renew = requestsCasReauthentication(req);
    if (!ticket) {
      this.redirect(casLoginUrl(this.ssoBaseURL, service, renew));
      return;
    }

    validateCas1Ticket(this.ssoBaseURL, ticket, service, this.validationTimeoutMs, renew)
      .then((login) => {
        this.verify(login, (err, user, info) => {
          if (err) {
            this.error(err);
            return;
          }
          if (!user) {
            this.fail(info as passport.StrategyFailure | undefined);
            return;
          }
          this.success(user, info);
        });
      })
      .catch((error: unknown) => this.error(error));
  }
}
