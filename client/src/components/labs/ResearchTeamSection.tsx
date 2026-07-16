import type { LabMember, LabMemberRole, LabRosterDisclosure } from '../../types/labDetail';
import { EXTERNAL_LINK_REL, safeHttpUrl } from '../../utils/url';

const MAX_PRESENTED_TEAM_MEMBERS = 24;

const GROUPS: Array<{ role: LabMemberRole; label: string }> = [
  { role: 'postdoc', label: 'Postdoctoral researchers' },
  { role: 'grad-student', label: 'Graduate students' },
  { role: 'undergrad', label: 'Undergraduate researchers' },
  { role: 'staff', label: 'Research staff' },
  { role: 'core-faculty', label: 'Faculty' },
  { role: 'affiliate', label: 'Other current members' },
];

const displayName = (member: LabMember): string =>
  member.user.displayName || [member.user.fname, member.user.lname].filter(Boolean).join(' ');

const observedLabel = (value?: string): string => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
};

const emptyCopy = (status: LabRosterDisclosure['status']): string => {
  if (status === 'optional-source-failure') {
    return 'The optional official roster source could not be refreshed. Team size is unknown.';
  }
  if (status === 'withheld') {
    return 'Current roster evidence is under review, so member names are withheld.';
  }
  return 'No verified current roster data is available. This does not mean the team is empty.';
};

export default function ResearchTeamSection({
  members,
  roster,
}: {
  members: LabMember[];
  roster: LabRosterDisclosure;
}) {
  const teamMembers = members
    .filter((member) => Boolean(member.rosterEvidence))
    .slice(0, MAX_PRESENTED_TEAM_MEMBERS);
  const sourceUrl = safeHttpUrl(roster.sourceUrl);
  const dateLabel = observedLabel(roster.observedAt);

  return (
    <section aria-labelledby="research-team-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="research-team-heading"
          className="text-xs font-semibold uppercase tracking-wider text-gray-600"
        >
          Current research team
        </h2>
        {dateLabel && (
          <span className="text-xs text-gray-500">Official roster observed {dateLabel}</span>
        )}
      </div>

      {teamMembers.length === 0 ? (
        <div
          className="rounded-md border border-dashed border-[var(--yr-line)] bg-[var(--yr-panel)] px-4 py-5"
        >
          <p className="text-sm leading-relaxed text-gray-700">{emptyCopy(roster.status)}</p>
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel={EXTERNAL_LINK_REL}
              className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-blue-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
            >
              Review official roster source
            </a>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {roster.status === 'partial' && (
            <p
              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
            >
              Some current members are withheld while their evidence is reviewed.
            </p>
          )}
          {roster.status === 'optional-source-failure' && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              The optional source could not be refreshed. This last verified snapshot is shown only
              until its freshness window expires.
            </p>
          )}
          {GROUPS.map(({ role, label }) => {
            const groupedMembers = teamMembers.filter((member) => member.role === role);
            if (groupedMembers.length === 0) return null;
            return (
              <div key={role}>
                <h3 className="mb-2 text-sm font-semibold text-gray-900">{label}</h3>
                <ul className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                  {groupedMembers.map((member) => {
                    const name = displayName(member);
                    const profileUrl = safeHttpUrl(member.rosterEvidence?.profileUrl);
                    const content = (
                      <>
                        <span className="block font-semibold text-gray-900">{name}</span>
                        {member.user.title && (
                          <span className="mt-0.5 block text-xs leading-relaxed text-gray-600">
                            {member.user.title}
                          </span>
                        )}
                      </>
                    );
                    return (
                      <li
                        key={`${member.user.publicKey || name}-${member.role}`}
                        className="min-w-0 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] px-3 py-2 text-sm"
                      >
                        {profileUrl ? (
                          <a
                            href={profileUrl}
                            target="_blank"
                            rel={EXTERNAL_LINK_REL}
                            className="block min-h-11 rounded-sm py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                            aria-label={`${name}, ${label}. Open official public profile`}
                          >
                            {content}
                          </a>
                        ) : (
                          <div className="min-h-11 py-1">{content}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          <p className="text-xs leading-relaxed text-gray-500">
            Membership is shown for team context only. It is not a recommendation to contact an
            individual.
            {sourceUrl && (
              <>
                {' '}
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel={EXTERNAL_LINK_REL}
                  className="font-semibold text-blue-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                >
                  Official roster source
                </a>
              </>
            )}
          </p>
          {roster.truncated && (
            <p className="text-xs text-gray-500">Additional verified members are not shown here.</p>
          )}
        </div>
      )}
    </section>
  );
}
