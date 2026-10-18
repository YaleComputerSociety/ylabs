import { useState } from 'react';
import type { FellowshipRecipient } from '../../types/researchGroup';
import { EXTERNAL_LINK_REL, safeHttpUrl } from '../../utils/url';

const SHOWN_FIRST = 6;

const lastName = (name: string): string => {
  const tokens = name.trim().split(/\s+/);
  return tokens[tokens.length - 1] ?? name;
};

const byYearThenLastName = (left: FellowshipRecipient, right: FellowshipRecipient): number =>
  right.year - left.year ||
  lastName(left.studentName).localeCompare(lastName(right.studentName), 'en', {
    sensitivity: 'base',
  }) ||
  left.studentName.localeCompare(right.studentName, 'en', { sensitivity: 'base' });

const shortProgramName = (programName: string): string => programName.split(' (')[0].trim();

function ProgramRecipients({
  programName,
  recipients,
}: {
  programName: string;
  recipients: FellowshipRecipient[];
}) {
  const [showAll, setShowAll] = useState(false);
  const listId = `fellowship-recipients-${programName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  const shown = showAll ? recipients : recipients.slice(0, SHOWN_FIRST);
  const sourceUrl = recipients.map((recipient) => safeHttpUrl(recipient.sourceUrl)).find(Boolean);

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-ink">
        {programName} fellows mentored here ({recipients.length})
      </h3>
      <ul id={listId} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        {shown.map((recipient) => (
          <li
            key={`${recipient.studentName}-${recipient.year}`}
            className="min-w-0 rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4"
          >
            <span className="rounded-full bg-[var(--yr-panel-muted)] px-2 py-1 text-xs font-medium text-ink-soft yr-num">
              {recipient.year}
            </span>
            <p className="mt-3 text-sm font-semibold text-ink">{recipient.studentName}</p>
            {recipient.projectTitle && (
              <p className="mt-1 text-sm leading-relaxed text-muted">{recipient.projectTitle}</p>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-x-4">
        {recipients.length > SHOWN_FIRST && (
          <button
            type="button"
            aria-expanded={showAll}
            aria-controls={listId}
            onClick={() => setShowAll((value) => !value)}
            className="min-h-11 rounded-control text-xs font-semibold text-brand underline-offset-4 hover:underline yr-focus-ring"
          >
            {showAll ? 'Show fewer' : `Show all ${recipients.length}`}
          </button>
        )}
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel={EXTERNAL_LINK_REL}
            className="yr-pressable inline-flex min-h-11 items-center rounded-control text-xs font-semibold text-brand underline-offset-4 hover:underline yr-focus-ring"
          >
            {programName} symposium booklet
          </a>
        )}
      </div>
    </div>
  );
}

export default function FellowshipRecipientsSection({
  recipients,
}: {
  recipients?: FellowshipRecipient[];
}) {
  const byProgram = new Map<string, FellowshipRecipient[]>();
  for (const recipient of recipients ?? []) {
    const programName = shortProgramName(recipient.programName);
    byProgram.set(programName, [...(byProgram.get(programName) ?? []), recipient]);
  }
  if (byProgram.size === 0) return null;

  return (
    <section aria-labelledby="fellowship-recipients-heading">
      <h2 id="fellowship-recipients-heading" className="yr-kicker mb-3">
        Undergraduate fellows
      </h2>
      <div className="space-y-5">
        {[...byProgram.entries()].map(([programName, programRecipients]) => (
          <ProgramRecipients
            key={programName}
            programName={programName}
            recipients={[...programRecipients].sort(byYearThenLastName)}
          />
        ))}
        <p className="text-xs leading-relaxed text-muted">
          Listed from Yale College fellowship symposium records of the students this lab's research
          lead mentored.
        </p>
      </div>
    </section>
  );
}
