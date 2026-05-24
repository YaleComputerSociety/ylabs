import { sanitizeProfileResearchTerms } from '../utils/profileResearchTerms';

export interface ProfileResearchTermUser {
  _id: unknown;
  netid?: string | null;
  fname?: string | null;
  lname?: string | null;
  researchInterests?: string[] | null;
  topics?: string[] | null;
}

export interface ProfileResearchTermCleanupPlan {
  userId: string;
  netid: string;
  name: string;
  nextResearchInterests: string[];
  nextTopics: string[];
  before: {
    researchInterests: string[];
    topics: string[];
  };
  after: {
    researchInterests: string[];
    topics: string[];
  };
  researchInterestsChanged: boolean;
  topicsChanged: boolean;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function truncateArray(values: string[]): string[] {
  return values.slice(0, 12);
}

export function planProfileResearchTermCleanup(
  users: ProfileResearchTermUser[],
): ProfileResearchTermCleanupPlan[] {
  return users
    .map((user) => {
      const researchInterests = Array.isArray(user.researchInterests)
        ? user.researchInterests
        : [];
      const topics = Array.isArray(user.topics) ? user.topics : [];
      const nextResearchInterests = sanitizeProfileResearchTerms(researchInterests);
      const nextTopics = sanitizeProfileResearchTerms(topics);
      const researchInterestsChanged = !arraysEqual(researchInterests, nextResearchInterests);
      const topicsChanged = !arraysEqual(topics, nextTopics);

      return {
        userId: String(user._id),
        netid: String(user.netid || ''),
        name: [user.fname, user.lname].filter(Boolean).join(' '),
        nextResearchInterests,
        nextTopics,
        before: {
          researchInterests: truncateArray(researchInterests),
          topics: truncateArray(topics),
        },
        after: {
          researchInterests: truncateArray(nextResearchInterests),
          topics: truncateArray(nextTopics),
        },
        researchInterestsChanged,
        topicsChanged,
      };
    })
    .filter((plan) => plan.researchInterestsChanged || plan.topicsChanged);
}
