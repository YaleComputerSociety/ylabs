import { Request, Response, Router } from "express";
import { isAuthenticated, isAdmin } from '../utils/permissions';
import { getAnalytics } from '../services/analyticsService';

const router = Router();

// Get all analytics data (admin only)
router.get('/', isAuthenticated, isAdmin, async (request: Request, response: Response) => {
    try {
        const analytics = await getAnalytics();
        response.status(200).json(analytics);
    } catch (error) {
        console.error('Error fetching analytics:', error);
        response.status(500).json({ error: error.message });
    }
});

export default router;