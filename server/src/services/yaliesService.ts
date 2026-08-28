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

export const classifyYalieByNetid = async (netid: any): Promise<YaliesIdentity | null> => {
  try {
    const normalizedNetid = normalizeYaliesNetid(netid);
    if (!normalizedNetid) return null;

    const apiKey = yaliesApiKey();
    if (!apiKey) {
      console.error('YALIES_API_KEY not set');
      return null;
    }

    let yaliesResponse;
    try {
      yaliesResponse = await axios.post(
        YALIES_API_URL,
        { filters: { netid: [normalizedNetid] } },
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout: YALIES_API_TIMEOUT_MS },
      );
    } catch (error) {
      console.error('Error fetching from Yalies API:', sanitizeLogValue(yaliesRequestError(error)));
      return null;
    }

    const yaliesData = yaliesResponse.data;
    if (!yaliesData || yaliesData.length === 0) {
      return null;
    }

    const yalie = yaliesData[0];
    const responseNetid = normalizeYaliesNetid(yalie.netid) || normalizedNetid;

    if (
      !yalie.first_name ||
      !yalie.last_name ||
      !yalie.email ||
      !yalie.year ||
      !yalie.school_code
    ) {
      return null;
    }

    return {
      netid: responseNetid,
      fname: yalie.first_name || '',
      lname: yalie.last_name || '',
      email: yalie.email,
      college: yalie.college || '',
      year: yalie.year,
      userType: yalie.school_code === 'YC' ? 'undergraduate' : 'graduate',
      userConfirmed: true,
      major: (yalie.major && Array.isArray(yalie.major) ? yalie.major : [yalie.major]) || [],
    };
  } catch (error) {
    console.error('Error fetching user:', sanitizeLogValue(error));
    return null;
  }
};

