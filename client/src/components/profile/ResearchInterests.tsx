import { Fragment } from 'react';

/**
 * Profile tab displaying research interests and topics.
 */
interface ResearchInterestsProps {
  interests: string[];
  topics: string[];
  summary?: string;
}

const SOURCE_CHROME_PATTERNS = [
  /\b(?:orcid\s*)?\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{3}[\dX]\b/gi,
  /\d+\s*YSM\s+Researchers?/gi,
  /View\s+(?:\d+\s+)?(?:Common|Related)\s+Publications?/gi,
  /View\s+(?:Lab Website|Full Profile|Related Publication)/gi,
];

function cleanResearchInterest(value: string): string {
  let cleaned = value.replace(/\s+/g, ' ').trim();
  for (const pattern of SOURCE_CHROME_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ');
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return /^(?:[\d,]+|publications?|citations?)$/i.test(cleaned) ? '' : cleaned;
}

function splitCleanResearchInterest(value: string): string[] {
  const cleaned = cleanResearchInterest(value);
  if (!cleaned) return [];

  const splitParts = cleaned
    .split(/(?<=[a-z)])(?=[A-Z][a-z])/g)
    .map((part) => part.trim())
    .filter(Boolean);

  if (splitParts.length > 1 && cleaned.length > 40) {
    return splitParts;
  }

  return [cleaned];
}

const ResearchInterests = ({ interests, topics, summary }: ResearchInterestsProps) => {
  const researchInterests = [...(topics || []), ...(interests || [])].reduce<string[]>(
    (merged, value) => {
      const cleanValues = splitCleanResearchInterest(value);
      if (cleanValues.length === 0) return merged;

      const next = [...merged];
      for (const trimmed of cleanValues) {
        const alreadyIncluded = next.some(
          (existing) => existing.toLowerCase() === trimmed.toLowerCase(),
        );
        if (!alreadyIncluded) {
          next.push(trimmed);
        }
      }
      return next;
    },
    [],
  );
  const researchSummary = (summary || '').trim();

  if (researchInterests.length === 0) {
    if (researchSummary) {
      return (
        <section>
          <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">
            Research Interests
          </h3>
          <p className="text-sm text-gray-700 leading-relaxed">{researchSummary}</p>
        </section>
      );
    }

    return (
      <p className="text-gray-500 text-sm py-8 text-center">No research interests available.</p>
    );
  }

  return (
    <section>
      <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">
        Research Interests
      </h3>
      <div className="flex flex-wrap gap-2">
        {researchInterests.map((interest, index) => (
          <Fragment key={interest}>
            <span className="rounded-md border border-blue-100 bg-blue-50 px-2.5 py-1 text-sm font-medium text-blue-800">
              {interest}
            </span>
            {index < researchInterests.length - 1 && <span className="sr-only">, </span>}
          </Fragment>
        ))}
      </div>
    </section>
  );
};

export default ResearchInterests;
