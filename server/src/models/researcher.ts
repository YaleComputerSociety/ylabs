import mongoose from 'mongoose';
import {
  canonicalSchemaVersionField,
  defineCanonicalSchemaVersion,
} from './canonicalSchemaVersion';

export const researcherSchemaVersion = defineCanonicalSchemaVersion({ currentVersion: 1 });

export const researcherProfileLinkKinds = [
  'YALE_OFFICIAL',
  'LAB_ABOUT',
  'PERSONAL_ACADEMIC',
  'GOOGLE_SCHOLAR',
  'ORCID',
] as const;
export type ResearcherProfileLinkKind = (typeof researcherProfileLinkKinds)[number];

export const researcherProfileLinkPurposes = ['PRIMARY_IDENTITY', 'SCHOLARLY'] as const;
export type ResearcherProfileLinkPurpose = (typeof researcherProfileLinkPurposes)[number];

export const researcherProfileLinkHealthStatuses = ['HEALTHY', 'UNAVAILABLE', 'UNKNOWN'] as const;
export type ResearcherProfileLinkHealthStatus =
  (typeof researcherProfileLinkHealthStatuses)[number];

export interface ResearcherProfileLink {
  kind: ResearcherProfileLinkKind;
  purpose: ResearcherProfileLinkPurpose;
  url: string;
  verifiedAt: Date;
  healthStatus: ResearcherProfileLinkHealthStatus;
}

export const researcherStatuses = ['ACTIVE', 'DEPARTED', 'UNKNOWN'] as const;
export type ResearcherStatus = (typeof researcherStatuses)[number];

export interface ResearcherIdentifiers {
  orcid?: string;
  netid?: string;
}

export interface ResearcherDisplayProfile {
  title?: string;
  primaryDepartment?: string;
  imageUrl?: string;
  websiteUrl?: string;
}

export interface ResearcherRecord {
  schemaVersion: number;
  displayName: string;
  accountId?: mongoose.Types.ObjectId;
  profileLinks: ResearcherProfileLink[];
  identifiers?: ResearcherIdentifiers;
  profile?: ResearcherDisplayProfile;
  status: ResearcherStatus;
  archived: boolean;
  dedupedIntoResearcherId?: mongoose.Types.ObjectId;
  dedupedAt?: Date;
}

const PROFILE_LINK_PURPOSE_BY_KIND: Record<
  ResearcherProfileLinkKind,
  ResearcherProfileLinkPurpose
> = {
  YALE_OFFICIAL: 'PRIMARY_IDENTITY',
  LAB_ABOUT: 'PRIMARY_IDENTITY',
  PERSONAL_ACADEMIC: 'PRIMARY_IDENTITY',
  GOOGLE_SCHOLAR: 'SCHOLARLY',
  ORCID: 'SCHOLARLY',
};

const ORCID_PATTERN = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

export function isValidOrcid(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  if (!ORCID_PATTERN.test(normalized)) return false;

  const characters = normalized.replaceAll('-', '');
  let total = 0;
  for (const character of characters.slice(0, 15)) {
    total = (total + Number(character)) * 2;
  }
  const checksumValue = (12 - (total % 11)) % 11;
  const checksum = checksumValue === 10 ? 'X' : String(checksumValue);
  return characters.at(-1) === checksum;
}

function parseHttpsUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

function orcidFromUrl(url: URL): string | undefined {
  if (url.hostname !== 'orcid.org' || url.search || url.hash) return undefined;
  const match = /^\/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])\/?$/.exec(url.pathname.toUpperCase());
  if (!match || !isValidOrcid(match[1])) return undefined;
  return match[1];
}

function isVerifiedProfileUrl(kind: ResearcherProfileLinkKind, value: string): boolean {
  const url = parseHttpsUrl(value);
  if (!url || url.username || url.password) return false;

  if (kind === 'YALE_OFFICIAL') {
    return url.hostname === 'yale.edu' || url.hostname.endsWith('.yale.edu');
  }
  if (kind === 'GOOGLE_SCHOLAR') {
    const scholarUserId = url.searchParams.get('user');
    return (
      url.hostname === 'scholar.google.com' &&
      url.pathname === '/citations' &&
      typeof scholarUserId === 'string' &&
      /^[A-Za-z0-9_-]+$/.test(scholarUserId)
    );
  }
  if (kind === 'ORCID') {
    return orcidFromUrl(url) !== undefined;
  }
  return true;
}

export const researcherProfileLinkSchema = new mongoose.Schema<ResearcherProfileLink>(
  {
    kind: {
      type: String,
      enum: [...researcherProfileLinkKinds],
      required: true,
    },
    purpose: {
      type: String,
      enum: [...researcherProfileLinkPurposes],
      required: true,
      validate: {
        validator: function (
          this: { kind?: ResearcherProfileLinkKind },
          value: ResearcherProfileLinkPurpose,
        ) {
          return this.kind !== undefined && PROFILE_LINK_PURPOSE_BY_KIND[this.kind] === value;
        },
        message: 'Profile link purpose is incompatible with its kind.',
      },
    },
    url: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2048,
      validate: {
        validator: function (this: { kind?: ResearcherProfileLinkKind }, value: string) {
          return this.kind !== undefined && isVerifiedProfileUrl(this.kind, value);
        },
        message: 'Profile link URL is not valid for its verified kind.',
      },
    },
    verifiedAt: {
      type: Date,
      required: true,
      validate: {
        validator: (value: Date) => value <= new Date(),
        message: 'verifiedAt cannot be in the future.',
      },
    },
    healthStatus: {
      type: String,
      enum: [...researcherProfileLinkHealthStatuses],
      default: 'UNKNOWN',
    },
  },
  {
    _id: false,
  },
);

export const researcherIdentifiersSchema = new mongoose.Schema<ResearcherIdentifiers>(
  {
    orcid: {
      type: String,
      required: false,
      trim: true,
      uppercase: true,
      validate: {
        validator: isValidOrcid,
        message: 'identifiers.orcid must be a valid ORCID identifier.',
      },
    },
    netid: {
      type: String,
      required: false,
      trim: true,
      lowercase: true,
      maxlength: 64,
    },
  },
  {
    _id: false,
  },
);

function hasBoundedUniqueProfileKinds(values: readonly ResearcherProfileLink[]): boolean {
  return (
    values.length <= researcherProfileLinkKinds.length &&
    new Set(values.map(({ kind }) => kind)).size === values.length
  );
}

function orcidProfileMatchesIdentifier(
  this: { identifiers?: { orcid?: string } },
  values: readonly ResearcherProfileLink[],
): boolean {
  const link = values.find(({ kind }) => kind === 'ORCID');
  if (!link) return true;

  const url = parseHttpsUrl(link.url);
  const profileOrcid = url ? orcidFromUrl(url) : undefined;
  if (profileOrcid === undefined) return true;

  return (
    this.identifiers?.orcid !== undefined && profileOrcid === this.identifiers.orcid.toUpperCase()
  );
}

export const researcherDisplayProfileSchema = new mongoose.Schema<ResearcherDisplayProfile>(
  {
    title: { type: String, trim: true, maxlength: 240 },
    primaryDepartment: { type: String, trim: true, maxlength: 240 },
    imageUrl: { type: String, trim: true, maxlength: 2048 },
    websiteUrl: { type: String, trim: true, maxlength: 2048 },
  },
  {
    _id: false,
  },
);

export const researcherSchema = new mongoose.Schema<ResearcherRecord>(
  {
    schemaVersion: canonicalSchemaVersionField(researcherSchemaVersion),
    displayName: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 240,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: false,
    },
    profileLinks: {
      type: [researcherProfileLinkSchema],
      default: [],
      validate: [
        {
          validator: hasBoundedUniqueProfileKinds,
          message: 'profileLinks must contain at most one verified link per kind.',
        },
        {
          validator: orcidProfileMatchesIdentifier,
          message: 'An ORCID profile link must match identifiers.orcid.',
        },
      ],
    },
    identifiers: {
      type: researcherIdentifiersSchema,
      default: undefined,
    },
    profile: {
      type: researcherDisplayProfileSchema,
      default: undefined,
    },
    status: {
      type: String,
      enum: [...researcherStatuses],
      default: 'UNKNOWN',
    },
    archived: {
      type: Boolean,
      default: false,
    },
    dedupedIntoResearcherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Researcher',
      required: false,
    },
    dedupedAt: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

researcherSchema.index({ accountId: 1 }, { unique: true, sparse: true });
researcherSchema.index({ 'identifiers.orcid': 1 }, { unique: true, sparse: true });
researcherSchema.index({ 'identifiers.netid': 1 }, { unique: true, sparse: true });
researcherSchema.index({ displayName: 1, status: 1, archived: 1 });

export const Researcher =
  mongoose.models.Researcher ||
  mongoose.model<ResearcherRecord>('Researcher', researcherSchema, 'researchers');
