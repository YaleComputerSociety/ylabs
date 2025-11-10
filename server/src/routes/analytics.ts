import { Request, Response, Router } from "express";
import { isAuthenticated, isAdmin } from '../utils/permissions';
import { getAnalytics } from '../services/analyticsService';
import { AnalyticsEvent, AnalyticsEventType } from '../models/analytics';


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

router.get('/debug', isAuthenticated, isAdmin, async (request: Request, response: Response) => {
    const events = await AnalyticsEvent.find({ 
        eventType: { $in: [AnalyticsEventType.LOGIN, AnalyticsEventType.VISITOR] } 
    }).limit(50);
    response.json(events);
});

export default router;