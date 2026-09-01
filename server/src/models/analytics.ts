/**
 * Mongoose schema and model for analytics events tracking user activity.
 */
import mongoose from 'mongoose';

export enum AnalyticsEventType {
  LOGIN = 'login',
  LOGOUT = 'logout',
  VISITOR = 'visitor',
  FELLOWSHIP_VIEW = 'fellowship_view',
  SEARCH = 'search',
  PROFILE_UPDATE = 'profile_update',
  // Research product surface events. These track engagement with canonical
  // research entities and privacy-safe interaction affordances.
  RESEARCH_VIEW = 'research_view',
  PATHWAY_SAVE = 'pathway_save',
  WAYS_IN_CLICK = 'ways_in_click',
  CONTACT_ROUTE_CLICK = 'contact_route_click',
  SOURCE_LINK_CLICK = 'source_link_click',
  // Canonical research-student journey events. Keep these claim-specific so
  // source inspection and planning activity can never be mistaken for access
  // conversion.
  RESEARCH_SEARCH = 'research_search',
  RESEARCH_ENTITY_IMPRESSION = 'research_entity_impression',
  RESEARCH_PROFILE_OPEN = 'research_profile_open',
  RESEARCH_SOURCE_REVIEW = 'research_source_review',
  RESEARCH_FILTER_CHANGE = 'research_filter_change',
  RESEARCH_SAVE = 'research_save',
  RESEARCH_COMPARE = 'research_compare',
  RESEARCH_PLAN_UPDATE = 'research_plan_update',
  RESEARCH_QUALIFIED_ACTION = 'research_qualified_action',
}

export const RESEARCH_ENTITY_TYPES = ['profile', 'fellowship', 'research_entity'] as const;
export type ResearchEntityType = (typeof RESEARCH_ENTITY_TYPES)[number];

const analyticsEventSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      enum: Object.values(AnalyticsEventType),
      required: true,
      index: true,
    },
    netid: {
      type: String,
      required: true,
      index: true,
    },
    userType: {
      type: String,
      enum: ['student', 'undergraduate', 'graduate', 'professor', 'admin', 'unknown'],
      required: true,
      index: true,
    },
    fellowshipId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
    },
    entityType: {
      type: String,
      enum: RESEARCH_ENTITY_TYPES,
      index: true,
    },
    entityId: {
      type: String,
      index: true,
    },
    searchQuery: {
      type: String,
    },
    searchDepartments: {
      type: [String],
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
    dedupeKey: {
      type: String,
      maxlength: 160,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  },
);

analyticsEventSchema.index({ eventType: 1, timestamp: -1 });
analyticsEventSchema.index({ netid: 1, timestamp: -1 });
analyticsEventSchema.index({ eventType: 1, netid: 1, timestamp: -1 });
analyticsEventSchema.index({ eventType: 1, entityType: 1, timestamp: -1 });
analyticsEventSchema.index(
  { netid: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);
analyticsEventSchema.index({ timestamp: -1 });

analyticsEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 94608000 });
export const AnalyticsEvent = mongoose.model(
  'AnalyticsEvent',
  analyticsEventSchema,
  'analytics_events',
);
