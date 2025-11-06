import mongoose from "mongoose";

export enum AnalyticsEventType {
    LOGIN = 'login',
    LOGOUT = 'logout',
    LISTING_VIEW = 'listing_view',
    LISTING_FAVORITE = 'listing_favorite',
    LISTING_UNFAVORITE = 'listing_unfavorite',
    SEARCH = 'search',
    LISTING_CREATE = 'listing_create',
    LISTING_UPDATE = 'listing_update',
    LISTING_ARCHIVE = 'listing_archive',
    LISTING_UNARCHIVE = 'listing_unarchive',
    PROFILE_UPDATE = 'profile_update',
}

const analyticsEventSchema = new mongoose.Schema({
    eventType: {
        type: String,
        enum: Object.values(AnalyticsEventType),
        required: true,
        index: true
    },
    netid: {
        type: String,
        required: true,
        index: true
    },
    userType: {
        type: String,
        enum: ['undergraduate', 'graduate', 'professor', 'faculty', 'admin', 'unknown'],
        required: true,
        index: true
    },
    // Optional fields depending on event type
    listingId: {
        type: mongoose.Schema.Types.ObjectId,
        index: true
    },
    searchQuery: {
        type: String
    },
    searchDepartments: {
        type: [String]
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        // Can store any additional event-specific data for future implementations
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    timestamps: false
});

analyticsEventSchema.index({ eventType: 1, timestamp: -1 });
analyticsEventSchema.index({ netid: 1, timestamp: -1 });
analyticsEventSchema.index({ eventType: 1, netid: 1, timestamp: -1 });
analyticsEventSchema.index({ timestamp: -1 });

analyticsEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 94608000 });
export const AnalyticsEvent = mongoose.model('analytics_events', analyticsEventSchema);