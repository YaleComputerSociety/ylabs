export const SESSION_SECRET_PREVIOUS_ENV = 'SESSION_SECRET_PREVIOUS';

export interface SessionSigningKeyOptions {
  currentSecret: string;
  previousSecret?: string;
  isAcceptableSecret: (value: string) => boolean;
  requireStrongSecrets: boolean;
}

// cookie-session signs with the first key and verifies with any; a cookie verified by a
// later key is re-signed with the first, so active sessions move to the new secret.
// The overlap is bounded by SESSION_LIFETIME_MS, after which no older cookie can pass
// deserializeUser; docs/incident-runbook.md has the rotation steps.
export const sessionSigningKeys = ({
  currentSecret,
  previousSecret,
  isAcceptableSecret,
  requireStrongSecrets,
}: SessionSigningKeyOptions): string[] => {
  const previous = (previousSecret ?? '').trim();
  if (!previous) return [currentSecret];
  if (previous === currentSecret) {
    throw new Error(`${SESSION_SECRET_PREVIOUS_ENV} must differ from SESSION_SECRET.`);
  }
  if (requireStrongSecrets && !isAcceptableSecret(previous)) {
    throw new Error(
      `${SESSION_SECRET_PREVIOUS_ENV} must be a high-entropy string of at least 32 characters.`,
    );
  }
  return [currentSecret, previous];
};
