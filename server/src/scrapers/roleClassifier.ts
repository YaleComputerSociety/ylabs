import type { ContactRouteType } from '../models/researchAccessTypes';

export type ResearchPersonRoleCategory =
  | 'pi'
  | 'lab-manager'
  | 'student'
  | 'postdoc'
  | 'admin'
  | 'unknown';

export interface ResearchPersonRoleClassification {
  category: ResearchPersonRoleCategory;
  normalizedTitle: string;
  memberRole?: 'pi' | 'postdoc' | 'grad-student' | 'staff' | 'affiliate';
  contactRouteType?: ContactRouteType;
}

const normalizeTitle = (title: string | undefined | null): string =>
  String(title || '').trim().replace(/\s+/g, ' ');

const ADMIN_PATTERNS = [
  /\badministrative\b/i,
  /\badministrator\b/i,
  /\bassistant\s+director\b/i,
  /\bcoordinator\b/i,
  /\boperations\b/i,
  /\boffice\b/i,
  /\bprogram\s+assistant\b/i,
  /\bprogram\s+director\b/i,
  /\bassistant\s+director\s+of\s+(the\s+)?(lab|laboratory)\b/i,
  /\bmanager\b/i,
];

const STUDENT_PATTERNS = [
  /\bph\.?\s*d\.?\s+student\b/i,
  /\bphd\s+student\b/i,
  /\bgraduate\s+student\b/i,
  /\bdoctoral\s+(student|candidate)\b/i,
  /\bmaster'?s?\s+student\b/i,
];

const POSTDOC_PATTERNS = [
  /\bpost-?doctoral\b/i,
  /\bpostdoc\b/i,
];

const LAB_MANAGER_PATTERNS = [
  /\blab\s+manager\b/i,
  /\blaboratory\s+manager\b/i,
];

const PI_PATTERNS = [
  /\bprincipal\s+investigator\b/i,
  /\bPI\b/,
  /\bprofessor\b/i,
  /\bfaculty\s+director\b/i,
  /\bdirector\s+of\s+(the\s+)?(lab|laboratory)\b/i,
];

export function classifyResearchPersonRole(
  title: string | undefined | null,
): ResearchPersonRoleClassification {
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) return { category: 'unknown', normalizedTitle };

  if (LAB_MANAGER_PATTERNS.some((pattern) => pattern.test(normalizedTitle))) {
    return {
      category: 'lab-manager',
      normalizedTitle,
      memberRole: 'staff',
      contactRouteType: 'LAB_MANAGER',
    };
  }

  if (STUDENT_PATTERNS.some((pattern) => pattern.test(normalizedTitle))) {
    return { category: 'student', normalizedTitle, memberRole: 'grad-student' };
  }

  if (POSTDOC_PATTERNS.some((pattern) => pattern.test(normalizedTitle))) {
    return { category: 'postdoc', normalizedTitle, memberRole: 'postdoc' };
  }

  if (ADMIN_PATTERNS.some((pattern) => pattern.test(normalizedTitle))) {
    return { category: 'admin', normalizedTitle, memberRole: 'staff' };
  }

  if (PI_PATTERNS.some((pattern) => pattern.test(normalizedTitle))) {
    return { category: 'pi', normalizedTitle, memberRole: 'pi', contactRouteType: 'FACULTY_PI' };
  }

  return { category: 'unknown', normalizedTitle };
}

export function canOwnResearchEntity(role: ResearchPersonRoleClassification): boolean {
  return role.category === 'pi';
}

export function canSurfaceAsMember(role: ResearchPersonRoleClassification): boolean {
  return Boolean(role.memberRole);
}

export function canSurfaceAsContactRoute(role: ResearchPersonRoleClassification): boolean {
  return Boolean(role.contactRouteType);
}
