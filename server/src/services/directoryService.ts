/**
 * Yale directory API integration for faculty data lookup.
 */
import axios from "axios";

const DIRECTORY_URL = "https://directory.yale.edu/api/people";

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
  physical_location: string;
  building_desk: string;
  mailing_address: string;
}

/**
 * Faculty title detection — returns true if the title indicates a professor/faculty role.
 */
export function isFacultyTitle(title: string): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  const facultyKeywords = [
    'professor', 'lecturer', 'instructor', 'research scientist',
    'research fellow', 'senior lector', 'clinical',
  ];
  return facultyKeywords.some(kw => lower.includes(kw));
}

/**
 * Query the Yale Directory for a person by netid or name.
 * The public directory API at directory.yale.edu returns basic info
 * (name, department, title, email, phone, office) without auth.
 *
 * Returns null if the person is not found or the request fails.
 */
export async function fetchFromDirectory(query: string, searchType: 'netid' | 'name' = 'netid'): Promise<DirectoryPerson | null> {
  try {
    const response = await axios.get(DIRECTORY_URL, {
      params: { search: query, searchType },
      timeout: 8000,
      headers: {
        'User-Agent': 'YLabs/1.0',
        'Accept': 'application/json',
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
      physical_location: person.location || person.address || '',
      building_desk: person.office || person.building || '',
      mailing_address: person.mailing_address || person.postal_address || '',
    };
  } catch (error: any) {
    if (error.response?.status !== 404) {
      console.log(`Directory lookup for "${query}" failed: ${error.message}`);
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
  try {
    const response = await axios.get('https://directory.yale.edu', {
      params: { search: name },
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
      name,
      firstName: name.split(' ')[0] || '',
      lastName: name.split(' ').slice(1).join(' ') || '',
      email: emailMatch?.[0] || '',
      department: deptMatch?.[1]?.trim() || '',
      title: titleMatch?.[0]?.trim() || '',
      phone: '',
      upi: '',
      unit: '',
      physical_location: '',
      building_desk: '',
      mailing_address: '',
    };
  } catch {
    return null;
  }
}
