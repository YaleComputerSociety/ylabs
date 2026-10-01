/**
 * Yalies.io API integration for student and faculty data.
 */
import axios from 'axios';
import dotenv from 'dotenv';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

const YALIES_API_URL = 'https://api.yalies.io/v2/people';
const YALIES_API_TIMEOUT_MS = 10_000;
const YALIES_NETID_RE = /^[A-Za-z0-9]{2,12}$/;

const yaliesApiKey = () => String(process.env.YALIES_API_KEY || '').trim();

const normalizeYaliesNetid = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const netid = value.trim().toLowerCase();
  return YALIES_NETID_RE.test(netid) ? netid : undefined;
};

const yaliesRequestError = (error: unknown): Error => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const suffix = status ? ` with status ${status}` : '';
    return new Error(`Yalies API request failed${suffix}`);
  }
  return error instanceof Error ? error : new Error('Yalies API request failed');
};

export interface YaliesPerson {
  netid?: string;
  first_name?: string;
  last_name?: string;
  preferred_name?: string;
  email?: string;
  phone?: string;
  title?: string;
  school_code?: string;
  school_name?: string;
  school?: string;
  year?: string | number;
  college?: string;
  major?: string | string[];
  image?: string;
  orcid?: string;
  url?: string;
  unit_name?: string;
  organization_name?: string;
  primary_organization_name?: string;
  primary_division_name?: string;
}

export interface ListYaliesOptions {
  page?: number;
  pageSize?: number;
  filters?: Record<string, unknown>;
  userAgent?: string;
}

export async function listYalies(options: ListYaliesOptions = {}): Promise<YaliesPerson[]> {
  const apiKey = yaliesApiKey();
  if (!apiKey) {
    throw new Error('YALIES_API_KEY not set');
  }

  try {
    const response = await axios.post(
      YALIES_API_URL,
      {
        page: options.page,
        page_size: options.pageSize,
        filters: options.filters || {},
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(options.userAgent ? { 'User-Agent': options.userAgent } : {}),
        },
        timeout: YALIES_API_TIMEOUT_MS,
      },
    );

    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    throw yaliesRequestError(error);
  }
}

export interface YaliesIdentity {
  netid: string;
  fname: string;
  lname: string;
  email: string;
  college: string;
  year: string | number;
  userType: 'undergraduate' | 'graduate';
  userConfirmed: boolean;
  major: string[];
}

export interface YaliesEmployee {
  netid: string;
  fname: string;
  lname: string;
  email: string;
  title: string;
  department: string;
}

export type YaliesLookup =
  | { kind: 'student'; identity: YaliesIdentity }
  | { kind: 'employee'; employee: YaliesEmployee }
  | { kind: 'not_found' }
  | { kind: 'unavailable' };

const NOT_FOUND: YaliesLookup = { kind: 'not_found' };
const UNAVAILABLE: YaliesLookup = { kind: 'unavailable' };

type YaliesRecord = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function studentIdentity(record: YaliesRecord, netid: string): YaliesIdentity {
  const major = record.major;
  return {
    netid,
    fname: text(record.first_name),
    lname: text(record.last_name),
    email: text(record.email),
    college: text(record.college),
    year: record.year as string | number,
    userType: record.school_code === 'YC' ? 'undergraduate' : 'graduate',
    userConfirmed: true,
    major: Array.isArray(major) ? major.map(String) : major ? [String(major)] : [],
  };
}

function employeeRecord(record: YaliesRecord, netid: string): YaliesEmployee {
  return {
    netid,
    fname: text(record.first_name),
    lname: text(record.last_name),
    email: text(record.email),
    title: text(record.title),
    department:
      text(record.unit_name) ||
      text(record.primary_division_name) ||
      text(record.organization_name) ||
      text(record.primary_organization_name),
  };
}

/**
 * Classify a netid against Yalies, keeping "not in Yalies" apart from "Yalies
 * could not answer". A caller that merges the two types a returning student
 * `unknown` whenever the request times out (#4234).
 *
 * A record carrying `year` and `school_code` is a student. One carrying a
 * `title` without them is an employee: Yalies lists faculty and staff with an
 * appointment title and organization but no enrolment fields.
 */
export const lookupYalieByNetid = async (netid: unknown): Promise<YaliesLookup> => {
  const normalizedNetid = normalizeYaliesNetid(netid);
  if (!normalizedNetid) return NOT_FOUND;

  const apiKey = yaliesApiKey();
  if (!apiKey) {
    console.error('YALIES_API_KEY not set');
    return UNAVAILABLE;
  }

  let records: unknown;
  try {
    const response = await axios.post(
      YALIES_API_URL,
      { filters: { netid: [normalizedNetid] } },
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: YALIES_API_TIMEOUT_MS },
    );
    records = response.data;
  } catch (error) {
    console.error('Error fetching from Yalies API:', sanitizeLogValue(yaliesRequestError(error)));
    return UNAVAILABLE;
  }

  const record = Array.isArray(records) ? (records[0] as YaliesRecord | undefined) : undefined;
  if (!record || typeof record !== 'object') return NOT_FOUND;

  const responseNetid = normalizeYaliesNetid(record.netid) || normalizedNetid;
  const hasName = Boolean(text(record.first_name) && text(record.last_name));
  if (!hasName || !text(record.email)) return NOT_FOUND;

  if (record.year && record.school_code) {
    return { kind: 'student', identity: studentIdentity(record, responseNetid) };
  }
  if (text(record.title)) {
    return { kind: 'employee', employee: employeeRecord(record, responseNetid) };
  }
  return NOT_FOUND;
};
