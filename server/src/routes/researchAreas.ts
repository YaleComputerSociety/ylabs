/**
 * Express routes for research area CRUD operations.
 */
import { Router, Request, Response, type NextFunction } from 'express';
import { isAuthenticated, isProfessor } from '../middleware/index';
import { ResearchArea, ResearchField, fieldColorKeys } from '../models/researchArea';
import { invalidateConfigCache } from '../services/configService';
import { escapeRegex, buildSafeSearchRegex } from '../utils/regex';

const router = Router();
const MAX_RESEARCH_AREA_NAME_LENGTH = 120;
const MAX_RESEARCH_AREA_SEARCH_QUERY_LENGTH = 120;

function setPrivateResearchAreaCacheHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  next();
}

router.use(setPrivateResearchAreaCacheHeaders);

router.get('/', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const customAreas = await ResearchArea.find({ isDefault: false })
      .select('name field')
      .sort({ name: 1 })
      .lean();

    res.status(200).json({ researchAreas: customAreas });
  } catch (error) {
    console.error('Error fetching research areas:', error);
    res.status(500).json({ message: 'Error fetching research areas' });
  }
});

router.post('/', isAuthenticated, isProfessor, async (req: Request, res: Response) => {
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

    const trimmedName = name.trim();
    if (trimmedName.length > MAX_RESEARCH_AREA_NAME_LENGTH) {
      return res.status(400).json({ message: 'Research area name is too long' });
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
    console.error('Error adding research area:', error);
    res.status(500).json({ message: 'Error adding research area' });
  }
});

router.get('/search', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const { query } = req.query;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ message: 'Search query is required' });
    }

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return res.status(400).json({ message: 'Search query is required' });
    }

    if (trimmedQuery.length > MAX_RESEARCH_AREA_SEARCH_QUERY_LENGTH) {
      return res.status(400).json({ message: 'Search query is too long' });
    }

    const customAreas = await ResearchArea.find({
      name: buildSafeSearchRegex(trimmedQuery),
      isDefault: false,
    })
      .select('name field')
      .limit(20)
      .lean();

    res.status(200).json({ researchAreas: customAreas });
  } catch (error) {
    console.error('Error searching research areas:', error);
    res.status(500).json({ message: 'Error searching research areas' });
  }
});

export default router;
