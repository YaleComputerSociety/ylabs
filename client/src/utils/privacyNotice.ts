export const PRIVACY_PATH = '/privacy';
export const PRIVACY_PAGE_TITLE = 'Privacy';
export const PRIVACY_LINK_LABEL = 'Privacy';
export const PRIVACY_QUESTIONS_URL = 'https://github.com/YaleComputerSociety/ylabs/issues';
export const ACTIVITY_RECORD_RETENTION_DAYS = 1095;
export const ACTIVITY_RECORD_RETENTION_DAYS_LABEL = new Intl.NumberFormat('en-US').format(
  ACTIVITY_RECORD_RETENTION_DAYS,
);
export const SESSION_COOKIE_LIFETIME_DAYS = 30;

// Every third-party origin the page loads from or sends to must be named here and on the
// page. `server/src/middleware/__tests__/privacyNoticeDisclosures.test.ts` imports this list
// and fails when the Content-Security-Policy allows an origin it does not cover.
export const PRIVACY_NOTICE_DISCLOSED_ORIGINS = [
  'https://us.i.posthog.com',
  'https://us-assets.i.posthog.com',
  'https://*.sentry.io',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://yale.edu',
  'https://*.yale.edu',
  'https://ysm-res.cloudinary.com',
  'https://yalies.io',
  'https://*.yalies.io',
] as const;
