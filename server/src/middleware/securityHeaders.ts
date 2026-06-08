import { Request, Response, NextFunction } from 'express';
import { allowsNonProductionSecurityBypass } from '../utils/environment';

const CONNECT_SRC_ORIGINS = [
  "'self'",
  'https://yalelabs.io',
  'https://www.yalelabs.io',
  'https://yalelabs.onrender.com',
  'https://ylabs-gr4v.onrender.com',
  'https://sheets.googleapis.com',
  'https://www.google-analytics.com',
  'https://analytics.google.com',
  'https://region1.google-analytics.com',
  'https://stats.g.doubleclick.net',
];

const IMG_SRC_ORIGINS = [
  "'self'",
  'data:',
  'blob:',
  'https://yale.edu',
  'https://*.yale.edu',
  'https://ysm-res.cloudinary.com',
  'https://yalies.io',
  'https://www.google-analytics.com',
  'https://stats.g.doubleclick.net',
];

const connectSrcDirective = (allowLocalDevelopmentConnect: boolean) => {
  const origins = allowLocalDevelopmentConnect
    ? [...CONNECT_SRC_ORIGINS, 'http://localhost:4000']
    : CONNECT_SRC_ORIGINS;
  return `connect-src ${origins.join(' ')}`;
};

const imgSrcDirective = () => `img-src ${IMG_SRC_ORIGINS.join(' ')}`;

export const buildContentSecurityPolicy = (
  allowLocalDevelopmentConnect = allowsNonProductionSecurityBypass(),
) =>
  [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self' https://www.googletagmanager.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    imgSrcDirective(),
    connectSrcDirective(allowLocalDevelopmentConnect),
    "frame-src 'self' https://accounts.google.com",
    "form-action 'self' https://secure.its.yale.edu https://secure.its.yale.edu/cas https://accounts.google.com",
    "manifest-src 'self'",
  ].join('; ');

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
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Origin-Agent-Cluster', '?1');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.removeHeader('X-Powered-By');

  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
};
