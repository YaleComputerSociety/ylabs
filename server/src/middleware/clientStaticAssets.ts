import express from 'express';

const CONTENT_HASHED_ASSET_PATH = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;
const IMMUTABLE_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const isContentHashedAssetPath = (requestPath: string): boolean =>
  CONTENT_HASHED_ASSET_PATH.test(requestPath);

const isApiPath = (requestPath: string): boolean =>
  requestPath === '/api' || requestPath.startsWith('/api/');

function setNoStoreHeaders(res: express.Response) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function blockSourceMapAssetRequests(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (req.path.endsWith('.map')) {
    setNoStoreHeaders(res);
    return res.status(404).type('text/plain').send('Not found');
  }

  return next();
}

function setContentHashedAssetCacheHeaders(res: express.Response) {
  if (isContentHashedAssetPath(res.req.path)) {
    res.setHeader('Cache-Control', IMMUTABLE_ASSET_CACHE_CONTROL);
  }
}

export function createClientStaticAssets(clientDistPath: string): express.Router {
  const router = express.Router();
  router.use((req, _res, next) => (isApiPath(req.path) ? next('router') : next()));
  router.use(blockSourceMapAssetRequests);
  router.use(
    express.static(clientDistPath, {
      dotfiles: 'ignore',
      fallthrough: true,
      index: false,
      setHeaders: setContentHashedAssetCacheHeaders,
    }),
  );
  return router;
}
