/**
 * Express routes for custom research area creation.
 */
import { Router, Request, Response, type NextFunction } from 'express';
import { isAuthenticated, isProfessor } from '../middleware/index';
import { ResearchArea, ResearchField, fieldColorKeys } from '../models/researchArea';
import { invalidateConfigCache } from '../services/configService';
import { escapeRegex } from '../utils/regex';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { replaceAsciiControls } from '../utils/asciiControl';
import { writeLimit } from '../middleware/rateLimiters';

const router = Router();
const MAX_RESEARCH_AREA_NAME_LENGTH = 120;

const normalizeResearchAreaLabel = (value: string): string =>
  replaceAsciiControls(value, ' ').replace(/\s+/g, ' ').trim();

const hasDirectContactInfo = (value: string): boolean => redactDirectContactInfo(value) !== value;

function setPrivateResearchAreaCacheHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

router.use(setPrivateResearchAreaCacheHeaders);

router.post('/', writeLimit, isAuthenticated, isProfessor, async (req: Request, res: Response) => {
  try {
    const { name, field } = req.body;
    const currentUser = req.user as { netId?: string };

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ message: 'Research area name is required' });
    }

    if (!field || !Object.values(ResearchField).includes(field)) {
      return res.status(400).json({
        message: 'Valid field is required',
        validFields: Object.values(ResearchField),
      });
    }

    const trimmedName = normalizeResearchAreaLabel(name);
    if (!trimmedName) {
      return res.status(400).json({ message: 'Research area name is required' });
    }

    if (trimmedName.length > MAX_RESEARCH_AREA_NAME_LENGTH) {
      return res.status(400).json({ message: 'Research area name is too long' });
    }

    if (hasDirectContactInfo(trimmedName)) {
      return res
        .status(400)
        .json({ message: 'Research area name cannot include contact information' });
    }

    const existing = await ResearchArea.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(trimmedName)}$`, 'i') },
    });

    if (existing) {
      return res.status(409).json({
        message: 'Research area already exists',
        researchArea: { name: existing.name, field: existing.field },
      });
    }

    const newArea = new ResearchArea({
      name: trimmedName,
      field: field,
      colorKey: fieldColorKeys[field as ResearchField] || 'gray',
      addedBy: currentUser?.netId || 'anonymous',
      isDefault: false,
    });

    await newArea.save();

    invalidateConfigCache();

    res.status(201).json({
      message: 'Research area added successfully',
      researchArea: { name: newArea.name, field: newArea.field },
    });
  } catch (error) {
    console.error('Error adding research area:', sanitizeLogValue(error));
    res.status(500).json({ message: 'Error adding research area' });
  }
});

export default router;
