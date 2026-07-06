/**
 * Yale directory API integration for faculty data lookup.
 */
import axios from 'axios';
import { sanitizeLogValue } from '../utils/logSanitizer';

const DIRECTORY_URL = 'https://directory.yale.edu/api/people';
const MAX_DIRECTORY_QUERY_LENGTH = 120;
const DIRECTORY_SEARCH_TYPES = new Set(['netid', 'name']);

interface DirectoryPerson {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  department: string;
  title: string;
  phone: string;
  upi: string;
  unit: string;
  physicalLocation: string;
  buildingDesk: string;
  mailingAddress: string;
}

/**
 * Faculty title detection — returns true if the title indicates a professor/faculty role.
 */
export function isFacultyTitle(title: string): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  const facultyKeywords = [
    'professor',
    'lecturer',
    'instructor',
    'research scientist',
    'research fellow',
    'senior lector',
    'clinical',
  ];
  return facultyKeywords.some((kw) => lower.includes(kw));
}

/**
 * Query the Yale Directory for a person by netid or name.
 * The public directory API at directory.yale.edu returns basic info
 * (name, department, title, email, phone, office) without auth.
 *
 * Returns null if the person is not found or the request fails.
 */
export async function fetchFromDirectory(
  query: string,
  searchType: 'netid' | 'name' = 'netid',
): Promise<DirectoryPerson | null> {
  const safeQuery =
    typeof query === 'string' ? query.trim().replace(/\s+/g, ' ').slice(0, MAX_DIRECTORY_QUERY_LENGTH) : '';
  const safeSearchType = DIRECTORY_SEARCH_TYPES.has(searchType) ? searchType : 'netid';
  if (!safeQuery) return null;

  try {
    const response = await axios.get(DIRECTORY_URL, {
      params: { search: safeQuery, searchType: safeSearchType },
      timeout: 8000,
      headers: {
        'User-Agent': 'YLabs/1.0',
        Accept: 'application/json',
      },
    });

    const data = response.data;

    let person: any = null;
    if (Array.isArray(data) && data.length > 0) {
      person = data[0];
    } else if (data && typeof data === 'object' && !Array.isArray(data)) {
      if (data.name || data.first_name || data.netid) {
        person = data;
      } else if (data.results && Array.isArray(data.results) && data.results.length > 0) {
        person = data.results[0];
      }
    }

    if (!person) return null;

    return {
      name: person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim(),
      firstName: person.first_name || person.firstName || '',
      lastName: person.last_name || person.lastName || '',
      email: person.email || '',
      department: person.department || person.organization || '',
      title: person.title || '',
      phone: person.phone || person.telephone || '',
      upi: person.upi || '',
      unit: person.unit || person.organization_unit || '',
      physicalLocation: person.location || person.address || '',
      buildingDesk: person.office || person.building || '',
      mailingAddress: person.mailingAddress || person.postal_address || '',
    };
  } catch (error: any) {
    if (error.response?.status !== 404) {
      console.error('Directory lookup failed:', sanitizeLogValue(error));
    }
    return null;
  }
}

/**
 * Alternative: fetch from directory using a simple name-based search
 * by scraping the HTML response. This is a fallback if the JSON API
 * is not available.
 */
export async function fetchFromDirectoryHTML(name: string): Promise<DirectoryPerson | null> {
  const safeName =
    typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, MAX_DIRECTORY_QUERY_LENGTH) : '';
  if (!safeName) return null;

  try {
    const response = await axios.get('https://directory.yale.edu', {
      params: { search: safeName },
      timeout: 8000,
      headers: {
        'User-Agent': 'YLabs/1.0',
      },
    });

    const html = response.data;
    if (typeof html !== 'string') return null;

    const emailMatch = html.match(/([\w.-]+@yale\.edu)/);
    const titleMatch = html.match(/(?:Professor|Lecturer|Instructor|Research Scientist)[^\n<]*/i);
    const deptMatch = html.match(/(?:Department|Organization)[:\s]*([^<\n]+)/i);

    if (!emailMatch && !titleMatch) return null;

    return {
      name: safeName,
      firstName: safeName.split(' ')[0] || '',
      lastName: safeName.split(' ').slice(1).join(' ') || '',
      email: emailMatch?.[0] || '',
      department: deptMatch?.[1]?.trim() || '',
      title: titleMatch?.[0]?.trim() || '',
      phone: '',
      upi: '',
      unit: '',
      physicalLocation: '',
      buildingDesk: '',
      mailingAddress: '',
    };
  } catch {
    return null;
  }
}
