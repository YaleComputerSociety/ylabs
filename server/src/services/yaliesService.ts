/**
 * Yalies.io API integration for student and faculty data.
 */
import axios from 'axios';
import dotenv from 'dotenv';
import { createUser, validateUser } from './userService';
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

/**
 * Function to fetch a Yalie by NetID.
 * - First, check the database for cached data.
 * - If not found, fetch from Yalies API, validate required fields, store it in the database, and return it.
 */
export const fetchYalie = async (netid: any) => {
  try {
    const normalizedNetid = normalizeYaliesNetid(netid);
    if (!normalizedNetid) return null;

    const existingUser = await validateUser(normalizedNetid);
    if (existingUser) {
      return existingUser;
    }

    let yaliesResponse;
    const apiKey = yaliesApiKey();
    if (!apiKey) {
      console.error('YALIES_API_KEY not set');
      return null;
    }

    try {
      console.log('Yalies: making post request');
      yaliesResponse = await axios.post(
        YALIES_API_URL,
        { filters: { netid: [normalizedNetid] } },
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout: YALIES_API_TIMEOUT_MS },
      );
    } catch (error) {
      console.error('Error fetching from Yalies API:', sanitizeLogValue(yaliesRequestError(error)));
      return null;
    }
    console.log('Yalies: done making post request');
    const yaliesData = yaliesResponse.data;

    if (!yaliesData || yaliesData.length === 0) {
      console.log('No Yalie found for requested NetID');
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
      console.log('Missing required fields from Yalies API response');
      return null;
    }

    let userType;

    if (yalie.school_code === 'YC') {
      userType = 'undergraduate';
    } else {
      userType = 'graduate';
    }

    const userData = {
      netid: responseNetid,
      fname: yalie.first_name || '',
      lname: yalie.last_name || '',
      email: yalie.email,
      college: yalie.college || '',
      year: yalie.year,
      userType: userType,
      userConfirmed: true,
      major: (yalie.major && Array.isArray(yalie.major) ? yalie.major : [yalie.major]) || [],
    };

    console.log('Yalies: saving user to mongoDB');

    const user = await createUser(userData);
    console.log('Yalies: user saved, returning user');

    return user;
  } catch (error) {
    console.error('Error fetching user:', sanitizeLogValue(error));
    return null;
  }
};
