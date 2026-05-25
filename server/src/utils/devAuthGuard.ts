/**
 * Guardrails for local-only development users.
 */

const DEV_EMAIL_DOMAIN = '@example.test';

const isDevFixtureUser = (user: any): boolean =>
  String(user?.email || '').toLowerCase().endsWith(DEV_EMAIL_DOMAIN) &&
  String(user?.fname || '') === 'Dev';

export const isDevFixtureNetid = (netid: unknown): boolean => {
  const value = String(netid || '').trim().toLowerCase();
  return ['devadmin', 'devprof', 'devstudent', 'test123', 'admin1'].includes(value);
};

export const isDevFixtureAccount = (user: any): boolean =>
  isDevFixtureNetid(user?.netid) ||
  String(user?.email || '').toLowerCase().endsWith(DEV_EMAIL_DOMAIN);

export function assertCanOverwriteWithDevUser(
  existing: any,
  nextUser: { netId: string; userType: string },
) {
  if (!existing) return;
  if (isDevFixtureUser(existing)) return;

  throw new Error(
    `Refusing to overwrite existing non-dev user ${nextUser.netId} with a local dev fixture. Use devadmin for local admin testing.`,
  );
}
