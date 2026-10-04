import { Request, Response, NextFunction } from 'express';
import {
  allowsNonProductionSecurityBypass,
  requiresDeployedRuntimeSecurity,
} from '../utils/environment';

const CONNECT_SRC_ORIGINS = [
  "'self'",
  'https://yalelabs.io',
  'https://www.yalelabs.io',
  'https://yalelabs.onrender.com',
  'https://ylabs-gr4v.onrender.com',
];

const IMG_SRC_ORIGINS = [
  "'self'",
  'data:',
  'blob:',
  'https://yale.edu',
  'https://*.yale.edu',
  'https://ysm-res.cloudinary.com',
  'https://yalies.io',
  'https://*.yalies.io',
];

const SENTRY_INGEST_HOST = /^o\d+\.ingest(?:\.[a-z]{2})?\.sentry\.io$/;

export const sentryIngestOrigin = (dsn: unknown): string | undefined => {
  if (typeof dsn !== 'string' || dsn.length === 0) return undefined;

  try {
    const parsed = new URL(dsn);
    const isSentryIngest =
      parsed.protocol === 'https:' && !parsed.port && SENTRY_INGEST_HOST.test(parsed.hostname);
    return isSentryIngest ? `https://${parsed.hostname}` : undefined;
  } catch {
    return undefined;
  }
};

const connectSrcDirective = (allowLocalDevelopmentConnect: boolean) => {
  const sentryOrigin = sentryIngestOrigin(process.env.VITE_SENTRY_DSN);
  const origins = [
    ...CONNECT_SRC_ORIGINS,
    ...(sentryOrigin ? [sentryOrigin] : []),
    ...(allowLocalDevelopmentConnect ? ['http://localhost:4000'] : []),
  ];
  return `connect-src ${origins.join(' ')}`;
};

const imgSrcDirective = () => `img-src ${IMG_SRC_ORIGINS.join(' ')}`;

export const buildContentSecurityPolicy = (
  allowLocalDevelopmentConnect = allowsNonProductionSecurityBypass(),
) => {
  const directives = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self'",
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    imgSrcDirective(),
    connectSrcDirective(allowLocalDevelopmentConnect),
    "frame-src 'none'",
    "form-action 'self' https://secure.its.yale.edu https://secure.its.yale.edu/cas",
    "manifest-src 'self'",
  ];

  if (!allowLocalDevelopmentConnect) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
};

export const CONTENT_SECURITY_POLICY = buildContentSecurityPolicy(true);

export const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=()',
  'camera=()',
  'encrypted-media=()',
  'fullscreen=(self)',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'payment=()',
  'usb=()',
].join(', ');

export const securityHeaders = (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Content-Security-Policy', buildContentSecurityPolicy());
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Origin-Agent-Cluster', '?1');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.removeHeader('X-Powered-By');

  if (
    requiresDeployedRuntimeSecurity() ||
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https'
  ) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
};
