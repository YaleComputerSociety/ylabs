/**
 * Retired legacy Listings routes.
 *
 * The Mongo `listings` collection has been dropped. Keep this router mounted so
 * stale clients receive an explicit response instead of recreating collection
 * data through legacy CRUD paths.
 */
import { Router } from 'express';

const router = Router();

router.all('*', (_req, res) => {
  res.status(410).json({
    message: 'Legacy listings have been retired. Use Yale Labs and Programs instead.',
  });
});

export default router;
