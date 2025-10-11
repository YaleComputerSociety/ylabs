import { AnalyticsEvent, AnalyticsEventType } from "../models/Analytics";
import { User, NewListing } from "../models";
import mongoose from "mongoose";

// ==================== EVENT LOGGING ====================

export interface LogEventParams {
    eventType: AnalyticsEventType;
    netid: string;           
    userType: string;
    listingId?: string;
    searchQuery?: string;
    searchDepartments?: string[];
    metadata?: any;
}

export const logEvent = async (params: LogEventParams): Promise<void> => {
    try {
        // Insert event into analytics collection
        await AnalyticsEvent.create({
            eventType: params.eventType,
            netid: params.netid,
            userType: params.userType,
            listingId: params.listingId,
            searchQuery: params.searchQuery,
            searchDepartments: params.searchDepartments,
            metadata: params.metadata,
            timestamp: new Date()
        });

        // Update denormalized metrics on User model
        const now = new Date();
        const updateFields: any = {
            lastActive: now
        };

        // Special handling for login events
        if (params.eventType === AnalyticsEventType.LOGIN) {
            updateFields.lastLogin = now;
            updateFields.$inc = { loginCount: 1 };
        }

        // Update user (non-blocking, don't await)
        // If this fails, event is still logged successfully
        User.findOneAndUpdate(
            { netid: params.netid },
            updateFields
        ).catch(err => {
            console.error('Error updating user metrics:', err);
        });

    } catch (error) {
        console.error('Error logging analytics event:', error);
        // Don't throw - we don't want analytics failures to break the app
    }
};

// ==================== ANALYTICS QUERIES ====================

export const getAnalytics = async () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // ==================== VISITOR ANALYTICS - events ====================
    
    const visitorStats = await AnalyticsEvent.aggregate([
        {
            $match: {
                eventType: AnalyticsEventType.LOGIN
            }
        },
        {
            $facet: {
                // Unique visitors lifetime
                lifetimeVisitors: [
                    {
                        $group: {
                            _id: "$netid",
                            userType: { $first: "$userType" }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            total: { $sum: 1 }
                        }
                    }
                ],
                // Unique visitors lifetime by type
                lifetimeVisitorsByType: [
                    {
                        $group: {
                            _id: { netid: "$netid", userType: "$userType" }
                        }
                    },
                    {
                        $group: {
                            _id: "$_id.userType",
                            count: { $sum: 1 }
                        }
                    },
                    {
                        $project: {
                            _id: 0,
                            userType: "$_id",
                            count: 1
                        }
                    }
                ],
                // Unique visitors last 7 days
                last7DaysVisitors: [
                    {
                        $match: {
                            timestamp: { $gte: sevenDaysAgo }
                        }
                    },
                    {
                        $group: {
                            _id: "$netid",
                            userType: { $first: "$userType" }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            total: { $sum: 1 }
                        }
                    }
                ],
                // Unique visitors last 7 days by type
                last7DaysVisitorsByType: [
                    {
                        $match: {
                            timestamp: { $gte: sevenDaysAgo }
                        }
                    },
                    {
                        $group: {
                            _id: { netid: "$netid", userType: "$userType" }
                        }
                    },
                    {
                        $group: {
                            _id: "$_id.userType",
                            count: { $sum: 1 }
                        }
                    },
                    {
                        $project: {
                            _id: 0,
                            userType: "$_id",
                            count: 1
                        }
                    }
                ],
                // Unique visitors today
                todayVisitors: [
                    {
                        $match: {
                            timestamp: { $gte: today }
                        }
                    },
                    {
                        $group: {
                            _id: "$netid",
                            userType: { $first: "$userType" }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            total: { $sum: 1 }
                        }
                    }
                ],
                // Unique visitors today by type
                todayVisitorsByType: [
                    {
                        $match: {
                            timestamp: { $gte: today }
                        }
                    },
                    {
                        $group: {
                            _id: { netid: "$netid", userType: "$userType" }
                        }
                    },
                    {
                        $group: {
                            _id: "$_id.userType",
                            count: { $sum: 1 }
                        }
                    },
                    {
                        $project: {
                            _id: 0,
                            userType: "$_id",
                            count: 1
                        }
                    }
                ],
                // Total login events (shows frequency)
                totalLogins: [
                    {
                        $group: {
                            _id: null,
                            total: { $sum: 1 }
                        }
                    }
                ],
                // Login frequency last 7 days
                loginsLast7Days: [
                    {
                        $match: {
                            timestamp: { $gte: sevenDaysAgo }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            total: { $sum: 1 }
                        }
                    }
                ],
                // Logins today
                loginsToday: [
                    {
                        $match: {
                            timestamp: { $gte: today }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            total: { $sum: 1 }
                        }
                    }
                ]
            }
        }
    ]);

    // ==================== ENGAGEMENT ANALYTICS (from events) ====================

    const engagementStats = await AnalyticsEvent.aggregate([
        {
            $facet: {
                // Search activity
                searchStats: [
                    {
                        $match: {
                            eventType: AnalyticsEventType.SEARCH
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            totalSearches: { $sum: 1 },
                            searchesLast7Days: {
                                $sum: { $cond: [{ $gte: ["$timestamp", sevenDaysAgo] }, 1, 0] }
                            },
                            searchesToday: {
                                $sum: { $cond: [{ $gte: ["$timestamp", today] }, 1, 0] }
                            }
                        }
                    }
                ],
                // Most searched terms (last 30 days)
                topSearchQueries: [
                    {
                        $match: {
                            eventType: AnalyticsEventType.SEARCH,
                            timestamp: { $gte: thirtyDaysAgo },
                            searchQuery: { $exists: true, $ne: "" }
                        }
                    },
                    {
                        $group: {
                            _id: "$searchQuery",
                            count: { $sum: 1 }
                        }
                    },
                    { $sort: { count: -1 } },
                    { $limit: 10 },
                    {
                        $project: {
                            _id: 0,
                            query: "$_id",
                            count: 1
                        }
                    }
                ],
                // Listing view activity
                viewStats: [
                    {
                        $match: {
                            eventType: AnalyticsEventType.LISTING_VIEW
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            totalViews: { $sum: 1 },
                            viewsLast7Days: {
                                $sum: { $cond: [{ $gte: ["$timestamp", sevenDaysAgo] }, 1, 0] }
                            },
                            viewsToday: {
                                $sum: { $cond: [{ $gte: ["$timestamp", today] }, 1, 0] }
                            }
                        }
                    }
                ],
                // Favorite activity
                favoriteStats: [
                    {
                        $match: {
                            eventType: { $in: [AnalyticsEventType.LISTING_FAVORITE, AnalyticsEventType.LISTING_UNFAVORITE] }
                        }
                    },
                    {
                        $group: {
                            _id: "$eventType",
                            total: { $sum: 1 },
                            last7Days: {
                                $sum: { $cond: [{ $gte: ["$timestamp", sevenDaysAgo] }, 1, 0] }
                            }
                        }
                    },
                    {
                        $project: {
                            _id: 0,
                            eventType: "$_id",
                            total: 1,
                            last7Days: 1
                        }
                    }
                ],
                // Most viewed listings (last 30 days from events)
                trendingListings: [
                    {
                        $match: {
                            eventType: AnalyticsEventType.LISTING_VIEW,
                            timestamp: { $gte: thirtyDaysAgo },
                            listingId: { $exists: true }
                        }
                    },
                    {
                        $group: {
                            _id: "$listingId",
                            views: { $sum: 1 },
                            uniqueViewers: { $addToSet: "$netid" }
                        }
                    },
                    {
                        $project: {
                            listingId: "$_id",
                            views: 1,
                            uniqueViewers: { $size: "$uniqueViewers" }
                        }
                    },
                    { $sort: { views: -1 } },
                    { $limit: 10 }
                ],
                // User activity stats
                userActivityStats: [
                    {
                        $match: {
                            timestamp: { $gte: sevenDaysAgo }
                        }
                    },
                    {
                        $group: {
                            _id: "$netid",
                            totalEvents: { $sum: 1 }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            activeUsers: { $sum: 1 },
                            avgEventsPerUser: { $avg: "$totalEvents" }
                        }
                    }
                ],
                // Most active users (last 30 days)
                mostActiveUsers: [
                    {
                        $match: {
                            timestamp: { $gte: thirtyDaysAgo }
                        }
                    },
                    {
                        $group: {
                            _id: { netid: "$netid", userType: "$userType" },
                            eventCount: { $sum: 1 }
                        }
                    },
                    { $sort: { eventCount: -1 } },
                    { $limit: 10 },
                    {
                        $project: {
                            _id: 0,
                            netid: "$_id.netid",
                            userType: "$_id.userType",
                            eventCount: 1
                        }
                    }
                ]
            }
        }
    ]);

    // ==================== LISTING ANALYTICS - from db ====================

    const listingStats = await NewListing.aggregate([
        {
            $facet: {
                overview: [
                    {
                        $group: {
                            _id: null,
                            total: { $sum: 1 },
                            active: {
                                $sum: { $cond: [{ $and: [{ $eq: ["$archived", false] }, { $eq: ["$confirmed", true] }] }, 1, 0] }
                            },
                            archived: { $sum: { $cond: ["$archived", 1, 0] } },
                            unconfirmed: { $sum: { $cond: ["$confirmed", 0, 1] } }
                        }
                    }
                ],
                newListingsLast7Days: [
                    {
                        $match: {
                            createdAt: { $gte: sevenDaysAgo }
                        }
                    },
                    { $count: "count" }
                ],
                newListingsToday: [
                    {
                        $match: {
                            createdAt: { $gte: today }
                        }
                    },
                    { $count: "count" }
                ],
                listingsByDepartment: [
                    { $match: { archived: false, confirmed: true } },
                    { $unwind: "$departments" },
                    {
                        $group: {
                            _id: "$departments",
                            count: { $sum: 1 }
                        }
                    },
                    { $sort: { count: -1 } },
                    {
                        $project: {
                            _id: 0,
                            department: "$_id",
                            count: 1
                        }
                    }
                ],
                listingsPerProfessor: [
                    { $match: { archived: false, confirmed: true } },
                    {
                        $group: {
                            _id: {
                                ownerId: "$ownerId",
                                ownerFirstName: "$ownerFirstName",
                                ownerLastName: "$ownerLastName"
                            },
                            count: { $sum: 1 }
                        }
                    },
                    { $sort: { count: -1 } },
                    { $limit: 20 },
                    {
                        $project: {
                            _id: 0,
                            professorName: {
                                $concat: ["$_id.ownerFirstName", " ", "$_id.ownerLastName"]
                            },
                            netId: "$_id.ownerId",
                            count: 1
                        }
                    }
                ],
                viewsAndFavorites: [
                    {
                        $group: {
                            _id: null,
                            totalViews: { $sum: "$views" },
                            totalFavorites: { $sum: "$favorites" },
                            avgViews: { $avg: "$views" },
                            avgFavorites: { $avg: "$favorites" }
                        }
                    }
                ],
                topViewedListings: [
                    { $match: { confirmed: true, archived: false } },
                    { $sort: { views: -1 } },
                    { $limit: 10 },
                    {
                        $project: {
                            _id: 1,
                            title: 1,
                            ownerFirstName: 1,
                            ownerLastName: 1,
                            views: 1,
                            departments: 1
                        }
                    }
                ],
                topFavoritedListings: [
                    { $match: { confirmed: true, archived: false } },
                    { $sort: { favorites: -1 } },
                    { $limit: 10 },
                    {
                        $project: {
                            _id: 1,
                            title: 1,
                            ownerFirstName: 1,
                            ownerLastName: 1,
                            favorites: 1,
                            departments: 1
                        }
                    }
                ],
                viewsByDepartment: [
                    { $match: { confirmed: true, archived: false } },
                    { $unwind: "$departments" },
                    {
                        $group: {
                            _id: "$departments",
                            totalViews: { $sum: "$views" },
                            listingCount: { $sum: 1 },
                            avgViews: { $avg: "$views" }
                        }
                    },
                    { $sort: { totalViews: -1 } },
                    {
                        $project: {
                            _id: 0,
                            department: "$_id",
                            totalViews: 1,
                            listingCount: 1,
                            avgViews: { $round: ["$avgViews", 2] }
                        }
                    }
                ],
                listingsWithZeroViews: [
                    { $match: { views: 0, confirmed: true, archived: false } },
                    { $count: "count" }
                ]
            }
        }
    ]);

    // ==================== USER ANALYTICS - from db ====================

    const userStats = await User.aggregate([
        {
            $facet: {
                overview: [
                    {
                        $group: {
                            _id: null,
                            total: { $sum: 1 },
                            confirmed: { $sum: { $cond: ["$userConfirmed", 1, 0] } }
                        }
                    }
                ],
                byType: [
                    {
                        $group: {
                            _id: "$userType",
                            count: { $sum: 1 }
                        }
                    },
                    {
                        $project: {
                            _id: 0,
                            userType: "$_id",
                            count: 1
                        }
                    }
                ],
                newUsersLast7Days: [
                    {
                        $match: {
                            createdAt: { $gte: sevenDaysAgo }
                        }
                    },
                    { $count: "count" }
                ],
                newUsersToday: [
                    {
                        $match: {
                            createdAt: { $gte: today }
                        }
                    },
                    { $count: "count" }
                ],
                newUsersTodayByType: [
                    {
                        $match: {
                            createdAt: { $gte: today }
                        }
                    },
                    {
                        $group: {
                            _id: "$userType",
                            count: { $sum: 1 }
                        }
                    },
                    {
                        $project: {
                            _id: 0,
                            userType: "$_id",
                            count: 1
                        }
                    }
                ]
            }
        }
    ]);

    // ==================== FORMAT AND RETURN ====================

    const visitors = visitorStats[0];
    const engagement = engagementStats[0];
    const listings = listingStats[0];
    const users = userStats[0];

    const trendingListingIds = engagement.trendingListings.map((t: any) => t.listingId);
    const trendingListingsData = await NewListing.find({ _id: { $in: trendingListingIds } }).lean();
    const enrichedTrending = engagement.trendingListings.map((t: any) => {
        const listing = trendingListingsData.find((l: any) => l._id.toString() === t.listingId.toString());
        return {
            ...t,
            title: listing?.title,
            ownerFirstName: listing?.ownerFirstName,
            ownerLastName: listing?.ownerLastName,
            departments: listing?.departments
        };
    });

    return {
        visitors: {
            lifetime: {
                total: visitors.lifetimeVisitors[0]?.total || 0,
                byType: visitors.lifetimeVisitorsByType || []
            },
            last7Days: {
                total: visitors.last7DaysVisitors[0]?.total || 0,
                byType: visitors.last7DaysVisitorsByType || []
            },
            today: {
                total: visitors.todayVisitors[0]?.total || 0,
                byType: visitors.todayVisitorsByType || []
            },
            loginFrequency: {
                totalLogins: visitors.totalLogins[0]?.total || 0,
                loginsLast7Days: visitors.loginsLast7Days[0]?.total || 0,
                loginsToday: visitors.loginsToday[0]?.total || 0
            }
        },
        engagement: {
            search: engagement.searchStats[0] || { totalSearches: 0, searchesLast7Days: 0, searchesToday: 0 },
            topSearchQueries: engagement.topSearchQueries || [],
            views: engagement.viewStats[0] || { totalViews: 0, viewsLast7Days: 0, viewsToday: 0 },
            favorites: engagement.favoriteStats || [],
            trendingListings: enrichedTrending || [],
            userActivity: engagement.userActivityStats[0] || { activeUsers: 0, avgEventsPerUser: 0 },
            mostActiveUsers: engagement.mostActiveUsers || [],
            // From listing counters
            totalViewsFromCounters: listings.viewsAndFavorites[0]?.totalViews || 0,
            totalFavoritesFromCounters: listings.viewsAndFavorites[0]?.totalFavorites || 0,
            avgViews: listings.viewsAndFavorites[0]?.avgViews || 0,
            avgFavorites: listings.viewsAndFavorites[0]?.avgFavorites || 0,
            viewsByDepartment: listings.viewsByDepartment || []
        },
        listings: {
            overview: listings.overview[0] || { total: 0, active: 0, archived: 0, unconfirmed: 0 },
            newListingsLast7Days: listings.newListingsLast7Days[0]?.count || 0,
            newListingsToday: listings.newListingsToday[0]?.count || 0,
            byDepartment: listings.listingsByDepartment || [],
            byProfessor: listings.listingsPerProfessor || [],
            listingsWithZeroViews: listings.listingsWithZeroViews[0]?.count || 0,
            topViewedListings: listings.topViewedListings || [],
            topFavoritedListings: listings.topFavoritedListings || []
        },
        users: {
            overview: users.overview[0] || { total: 0, confirmed: 0 },
            byType: users.byType || [],
            newUsersLast7Days: users.newUsersLast7Days[0]?.count || 0,
            newUsersToday: users.newUsersToday[0]?.count || 0,
            newUsersTodayByType: users.newUsersTodayByType || []
        },
        timestamp: now.toISOString()
    };
};