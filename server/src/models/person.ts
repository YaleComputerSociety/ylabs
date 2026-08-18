import mongoose from 'mongoose';
import {
  canonicalSchemaVersionField,
  defineCanonicalSchemaVersion,
} from './canonicalSchemaVersion';

export const personSchemaVersion = defineCanonicalSchemaVersion({ currentVersion: 1 });

export const personProfileLinkKinds = [
  'YALE_OFFICIAL',
  'LAB_ABOUT',
  'PERSONAL_ACADEMIC',
  'GOOGLE_SCHOLAR',
  'ORCID',
] as const;
export type PersonProfileLinkKind = (typeof personProfileLinkKinds)[number];

export const personProfileLinkPurposes = ['PRIMARY_IDENTITY', 'SCHOLARLY'] as const;
export type PersonProfileLinkPurpose = (typeof personProfileLinkPurposes)[number];

export const personProfileLinkHealthStatuses = ['HEALTHY', 'UNAVAILABLE', 'UNKNOWN'] as const;
export type PersonProfileLinkHealthStatus = (typeof personProfileLinkHealthStatuses)[number];

export interface PersonProfileLink {
  kind: PersonProfileLinkKind;
  purpose: PersonProfileLinkPurpose;
  url: string;
  verifiedAt: Date;
  healthStatus: PersonProfileLinkHealthStatus;
}

export const personStatuses = ['ACTIVE', 'DEPARTED', 'UNKNOWN'] as const;
export type PersonStatus = (typeof personStatuses)[number];

export interface PersonIdentifiers {
  orcid?: string;
}

export interface PersonDisplayProfile {
  title?: string;
  primaryDepartment?: string;
  imageUrl?: string;
  websiteUrl?: string;
}

export interface PersonRecord {
  schemaVersion: number;
  displayName: string;
  accountId?: mongoose.Types.ObjectId;
  profileLinks: PersonProfileLink[];
  identifiers?: PersonIdentifiers;
  profile?: PersonDisplayProfile;
  status: PersonStatus;
  archived: boolean;
}

const PROFILE_LINK_PURPOSE_BY_KIND: Record<PersonProfileLinkKind, PersonProfileLinkPurpose> = {
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

function isVerifiedProfileUrl(kind: PersonProfileLinkKind, value: string): boolean {
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

export const personProfileLinkSchema = new mongoose.Schema<PersonProfileLink>(
  {
    kind: {
      type: String,
      enum: [...personProfileLinkKinds],
      required: true,
    },
    purpose: {
      type: String,
      enum: [...personProfileLinkPurposes],
      required: true,
      validate: {
        validator: function (
          this: { kind?: PersonProfileLinkKind },
          value: PersonProfileLinkPurpose,
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
        validator: function (this: { kind?: PersonProfileLinkKind }, value: string) {
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
      enum: [...personProfileLinkHealthStatuses],
      default: 'UNKNOWN',
    },
  },
  {
    _id: false,
  },
);

export const personIdentifiersSchema = new mongoose.Schema<PersonIdentifiers>(
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
  },
  {
    _id: false,
  },
);

function hasBoundedUniqueProfileKinds(values: readonly PersonProfileLink[]): boolean {
  return (
    values.length <= personProfileLinkKinds.length &&
    new Set(values.map(({ kind }) => kind)).size === values.length
  );
}

function orcidProfileMatchesIdentifier(
  this: { identifiers?: { orcid?: string } },
  values: readonly PersonProfileLink[],
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

export const personDisplayProfileSchema = new mongoose.Schema<PersonDisplayProfile>(
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

export const personSchema = new mongoose.Schema<PersonRecord>(
  {
    schemaVersion: canonicalSchemaVersionField(personSchemaVersion),
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
      type: [personProfileLinkSchema],
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
      type: personIdentifiersSchema,
      default: undefined,
    },
    profile: {
      type: personDisplayProfileSchema,
      default: undefined,
    },
    status: {
      type: String,
      enum: [...personStatuses],
      default: 'UNKNOWN',
    },
    archived: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

personSchema.index({ accountId: 1 }, { unique: true, sparse: true });
personSchema.index({ 'identifiers.orcid': 1 }, { unique: true, sparse: true });
personSchema.index({ displayName: 1, status: 1, archived: 1 });

export const Person =
  mongoose.models.Person || mongoose.model<PersonRecord>('Person', personSchema, 'people');
