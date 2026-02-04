import { Router, Request, Response } from "express";
import { isAuthenticated } from '../middleware';
import { ResearchArea, ResearchField, fieldColorKeys } from '../models/researchArea';
import { invalidateConfigCache } from '../services/configService';

const router = Router();

// Get all user-added research areas (not the defaults - those are in frontend)
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

// Add a new research area
router.post('/', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const { name, field } = req.body;
    const currentUser = req.user as { netId?: string };

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ message: 'Research area name is required' });
    }

    if (!field || !Object.values(ResearchField).includes(field)) {
      return res.status(400).json({
        message: 'Valid field is required',
        validFields: Object.values(ResearchField)
      });
    }

    const trimmedName = name.trim();

    // Check if already exists (case-insensitive)
    const existing = await ResearchArea.findOne({
      name: { $regex: new RegExp(`^${trimmedName}$`, 'i') }
    });

    if (existing) {
      return res.status(409).json({
        message: 'Research area already exists',
        researchArea: { name: existing.name, field: existing.field }
      });
    }

    // Create new research area
    const newArea = new ResearchArea({
      name: trimmedName,
      field: field,
      colorKey: fieldColorKeys[field as ResearchField] || 'gray',
      addedBy: currentUser?.netId || 'anonymous',
      isDefault: false
    });

    await newArea.save();

    // Invalidate config cache so new area appears in /api/config
    invalidateConfigCache();

    res.status(201).json({
      message: 'Research area added successfully',
      researchArea: { name: newArea.name, field: newArea.field }
    });
  } catch (error) {
    console.error('Error adding research area:', error);
    res.status(500).json({ message: 'Error adding research area' });
  }
});

// Search research areas (for autocomplete)
router.get('/search', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const { query } = req.query;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ message: 'Search query is required' });
    }

    const customAreas = await ResearchArea.find({
      name: { $regex: query, $options: 'i' },
      isDefault: false
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
