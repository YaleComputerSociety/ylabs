/**
 * Mongoose schema and model for analytics events tracking user activity.
 */
import mongoose from 'mongoose';
import { normalizeUserType } from './user';

export enum AnalyticsEventType {
  LOGIN = 'login',
  LOGOUT = 'logout',
  VISITOR = 'visitor',
  LISTING_VIEW = 'listing_view',
  LISTING_FAVORITE = 'listing_favorite',
  LISTING_UNFAVORITE = 'listing_unfavorite',
  FELLOWSHIP_VIEW = 'fellowship_view',
  FELLOWSHIP_FAVORITE = 'fellowship_favorite',
  FELLOWSHIP_UNFAVORITE = 'fellowship_unfavorite',
  SEARCH = 'search',
  OUTREACH_CLICK = 'outreach_click',
  OUTREACH_OUTCOME = 'outreach_outcome',
  LISTING_CREATE = 'listing_create',
  LISTING_UPDATE = 'listing_update',
  LISTING_ARCHIVE = 'listing_archive',
  LISTING_UNARCHIVE = 'listing_unarchive',
  PROFILE_UPDATE = 'profile_update',
  // Research product surface events. These track engagement with canonical
  // research entities and privacy-safe interaction affordances.
  RESEARCH_VIEW = 'research_view',
  PATHWAY_SAVE = 'pathway_save',
  WAYS_IN_CLICK = 'ways_in_click',
  CONTACT_ROUTE_CLICK = 'contact_route_click',
  SOURCE_LINK_CLICK = 'source_link_click',
  OUTREACH_CONTACT_REVEAL = 'outreach_contact_reveal',
  OUTREACH_CONTACT_ATTEMPT = 'outreach_contact_attempt',
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

export const RESEARCH_ENTITY_TYPES = [
  'profile',
  'listing',
  'fellowship',
  'research_entity',
] as const;
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
      set: normalizeUserType,
      enum: ['student', 'undergraduate', 'graduate', 'professor', 'admin', 'unknown'],
      required: true,
      index: true,
    },
    listingId: {
      type: mongoose.Schema.Types.ObjectId,
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
