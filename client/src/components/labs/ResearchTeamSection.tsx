import { useState } from 'react';
import type {
  LabMember,
  LabMemberRole,
  LabRosterDisclosure,
  LabRosterUndergraduate,
} from '../../types/labDetail';
import { EXTERNAL_LINK_REL, safeHttpUrl } from '../../utils/url';
import { isCorroboratedPersonPageUrl } from '../../utils/yalePersonPagePrefix';
import type { UndergraduateMemberLine } from '../../utils/undergraduateMemberEvidence';

const MAX_PRESENTED_TEAM_MEMBERS = 24;

type TeamGroup = { role: LabMemberRole; label: string };

const UNDERGRADUATE_GROUP: TeamGroup = { role: 'undergrad', label: 'Undergraduate researchers' };

const OTHER_GROUPS: TeamGroup[] = [
  { role: 'postdoc', label: 'Postdoctoral researchers' },
  { role: 'grad-student', label: 'Graduate students' },
  { role: 'staff', label: 'Research staff' },
  { role: 'core-faculty', label: 'Faculty' },
  { role: 'affiliated', label: 'Affiliated members' },
];

const displayName = (member: LabMember): string =>
  member.user.displayName || [member.user.fname, member.user.lname].filter(Boolean).join(' ');

const observedLabel = (value?: string): string => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
};

const PAST_UNDERGRADUATES_SHOWN_FIRST = 6;

const undergraduateYears = (member: LabRosterUndergraduate): string => {
  if (member.status === 'current') return member.startYear ? `${member.startYear} - present` : '';
  if (member.startYear && member.endYear && member.startYear !== member.endYear) {
    return `${member.startYear} - ${member.endYear}`;
  }
  return String(member.endYear ?? member.startYear ?? '');
};

const NAME_SUFFIX = /^(?:jr|sr|ii|iii|iv)\.?$/i;

const lastName = (name: string): string => {
  const tokens = name
    .replace(/\([^)]*\)/g, ' ')
    .trim()
    .split(/\s+/);
  while (tokens.length > 1 && NAME_SUFFIX.test(tokens[tokens.length - 1])) tokens.pop();
  return tokens[tokens.length - 1] ?? name;
};

const compareNames = (left: string, right: string): number =>
  left.localeCompare(right, 'en', { sensitivity: 'base' });

const byYearThenLastName = (
  left: LabRosterUndergraduate,
  right: LabRosterUndergraduate,
): number => {
  const leftYear = left.endYear ?? left.startYear ?? 0;
  const rightYear = right.endYear ?? right.startYear ?? 0;
  return (
    rightYear - leftYear ||
    compareNames(lastName(left.name), lastName(right.name)) ||
    compareNames(left.name, right.name)
  );
};

function UndergraduateLine({ member }: { member: LabRosterUndergraduate }) {
  const years = undergraduateYears(member);
  return (
    <li className="flex min-w-0 items-baseline justify-between gap-3 text-sm leading-relaxed">
      <span className="min-w-0 font-medium text-ink">{member.name}</span>
      {years && <span className="shrink-0 text-xs tabular-nums text-muted">{years}</span>}
    </li>
  );
}

function UndergraduateCard({
  member,
  profileUrl,
}: {
  member: LabRosterUndergraduate;
  profileUrl: string;
}) {
  const years = undergraduateYears(member);
  return (
    <li className="min-w-0 rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] px-3 py-2 text-sm">
      <a
        href={profileUrl}
        target="_blank"
        rel={EXTERNAL_LINK_REL}
        className="yr-pressable block min-h-11 rounded-control py-1 yr-focus-ring"
        aria-label={`${member.name}, undergraduate researcher. Open official public profile`}
      >
        <span className="block font-semibold text-ink">{member.name}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted">
          {years ? `Undergraduate · ${years}` : 'Undergraduate'}
        </span>
      </a>
    </li>
  );
}

function UndergraduateResearchers({
  undergraduates,
}: {
  undergraduates: LabRosterUndergraduate[];
}) {
  const [showAllPast, setShowAllPast] = useState(false);
  const current = undergraduates.filter((member) => member.status === 'current');
  const past = undergraduates.filter((member) => member.status === 'past').sort(byYearThenLastName);
  const shownPast = showAllPast ? past : past.slice(0, PAST_UNDERGRADUATES_SHOWN_FIRST);
  const withProfile = current.flatMap((member) => {
    const profileUrl = safeHttpUrl(member.profileUrl);
    return profileUrl ? [{ member, profileUrl }] : [];
  });
  const withoutProfile = current.filter((member) => !safeHttpUrl(member.profileUrl));

  return (
    <div>
      {current.length > 0 && (
        <>
          <h3 className="mb-1 text-sm font-semibold text-ink">Undergraduate researchers</h3>
          <p className="mb-2 text-xs leading-relaxed text-muted">
            Current undergraduates can tell you what research in this lab is like.
          </p>
        </>
      )}
      {withProfile.length > 0 && (
        <ul className="mb-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
          {withProfile.map(({ member, profileUrl }) => (
            <UndergraduateCard key={member.name} member={member} profileUrl={profileUrl} />
          ))}
        </ul>
      )}
      {withoutProfile.length > 0 && (
        <ul className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          {withoutProfile.map((member) => (
            <UndergraduateLine key={member.name} member={member} />
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <div className={current.length > 0 ? 'mt-4' : ''}>
          {current.length > 0 ? (
            <h4 className="mb-1 text-xs font-semibold text-muted">
              Past undergraduate researchers ({past.length})
            </h4>
          ) : (
            <h3 className="mb-1 text-sm font-semibold text-ink">
              Past undergraduate researchers ({past.length})
            </h3>
          )}
          <ul
            id="past-undergraduate-researchers"
            className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2"
          >
            {shownPast.map((member) => (
              <UndergraduateLine key={member.name} member={member} />
            ))}
          </ul>
          {past.length > PAST_UNDERGRADUATES_SHOWN_FIRST && (
            <button
              type="button"
              aria-expanded={showAllPast}
              aria-controls="past-undergraduate-researchers"
              onClick={() => setShowAllPast((value) => !value)}
              className="mt-2 min-h-11 rounded-control text-xs font-semibold text-brand underline-offset-4 hover:underline yr-focus-ring"
            >
              {showAllPast ? 'Show fewer' : `Show all ${past.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const memberLineHeading = (line: UndergraduateMemberLine): string =>
  line.status === 'current' ? 'Undergraduate researchers' : 'Past undergraduate researchers';

const memberLineText = (line: UndergraduateMemberLine): string =>
  line.status === 'current'
    ? `${line.count} current ${line.count === 1 ? 'undergraduate' : 'undergraduates'}`
    : 'past undergraduate researchers';

const memberLinePage = (sourceUrl: string, leadPersonNames: readonly string[]) =>
  isCorroboratedPersonPageUrl(sourceUrl, leadPersonNames)
    ? { lists: 'The official profile lists', link: 'See the profile' }
    : { lists: 'The lab’s own page lists', link: 'See the lab’s page' };

function UndergraduateMemberLineRow({
  line,
  leadPersonNames,
}: {
  line: UndergraduateMemberLine;
  leadPersonNames: readonly string[];
}) {
  const sourceUrl = safeHttpUrl(line.sourceUrl);
  const page = memberLinePage(sourceUrl, leadPersonNames);
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-ink">{memberLineHeading(line)}</h3>
      <p className="text-sm leading-relaxed text-ink-soft">
        {page.lists} {memberLineText(line)}.{' '}
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel={EXTERNAL_LINK_REL}
            className="-my-1.5 inline-block py-1.5 font-semibold text-brand underline-offset-4 hover:underline yr-focus-ring"
          >
            {page.link}
          </a>
        )}
      </p>
    </div>
  );
}

function TeamMemberGroup({
  group: { role, label },
  members,
}: {
  group: TeamGroup;
  members: LabMember[];
}) {
  const groupedMembers = members.filter((member) => member.role === role);
  if (groupedMembers.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-ink">{label}</h3>
      <ul className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        {groupedMembers.map((member) => {
          const name = displayName(member);
          const profileUrl = safeHttpUrl(member.rosterEvidence?.profileUrl);
          const content = (
            <>
              <span className="block font-semibold text-ink">{name}</span>
              {member.user.title && (
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                  {member.user.title}
                </span>
              )}
            </>
          );
          return (
            <li
              key={`${member.user.publicKey || name}-${member.role}`}
              className="min-w-0 rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] px-3 py-2 text-sm"
            >
              {profileUrl ? (
                <a
                  href={profileUrl}
                  target="_blank"
                  rel={EXTERNAL_LINK_REL}
                  className="yr-pressable block min-h-11 rounded-control py-1 yr-focus-ring"
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
}

export default function ResearchTeamSection({
  members,
  roster,
  undergraduateLines = [],
  leadPersonNames = [],
}: {
  members: LabMember[];
  roster: LabRosterDisclosure;
  undergraduateLines?: UndergraduateMemberLine[];
  leadPersonNames?: readonly string[];
}) {
  const undergraduates = roster.undergraduates ?? [];
  const listsCurrentUndergraduates = undergraduates.some((member) => member.status === 'current');
  const teamMembers = members
    .filter((member) => Boolean(member.rosterEvidence))
    .filter((member) => !(listsCurrentUndergraduates && member.role === 'undergrad'))
    .slice(0, MAX_PRESENTED_TEAM_MEMBERS);
  if (teamMembers.length === 0 && undergraduates.length === 0 && undergraduateLines.length === 0) {
    return null;
  }
  const hasCurrentTeam =
    teamMembers.length > 0 ||
    listsCurrentUndergraduates ||
    undergraduateLines.some((line) => line.status === 'current');
  const currentUndergraduateLines = undergraduateLines.filter((line) => line.status === 'current');
  const pastUndergraduateLines = undergraduateLines.filter((line) => line.status === 'past');
  const sourceUrl = safeHttpUrl(roster.sourceUrl);
  const alumniSourceUrl = safeHttpUrl(roster.alumniSourceUrl);
  const dateLabel = observedLabel(roster.observedAt);

  return (
    <section aria-labelledby="research-team-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="research-team-heading"
          className="text-xs font-semibold uppercase tracking-wider text-muted"
        >
          {hasCurrentTeam ? 'Current research team' : 'Research team'}
        </h2>
        {dateLabel && (
          <span className="text-xs text-muted">Official roster observed {dateLabel}</span>
        )}
      </div>

      <div className="space-y-5">
        {roster.status === 'partial' && (
          <p className="rounded-card border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            Some people on the lab’s page are not shown because their role could not be confirmed.
          </p>
        )}
        {roster.status === 'optional-source-failure' && (
          <p className="rounded-card border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            The optional source could not be refreshed. This last verified snapshot is shown only
            until its freshness window expires.
          </p>
        )}
        {currentUndergraduateLines.map((line) => (
          <UndergraduateMemberLineRow
            key={line.status}
            line={line}
            leadPersonNames={leadPersonNames}
          />
        ))}
        <TeamMemberGroup group={UNDERGRADUATE_GROUP} members={teamMembers} />
        {undergraduates.length > 0 && <UndergraduateResearchers undergraduates={undergraduates} />}
        {pastUndergraduateLines.map((line) => (
          <UndergraduateMemberLineRow
            key={line.status}
            line={line}
            leadPersonNames={leadPersonNames}
          />
        ))}
        {OTHER_GROUPS.map((group) => (
          <TeamMemberGroup key={group.role} group={group} members={teamMembers} />
        ))}
        {(teamMembers.length > 0 || undergraduates.length > 0) && (
          <p className="text-xs leading-relaxed text-muted">
            {undergraduates.length > 0 && teamMembers.length > 0
              ? 'Other members are shown for team context only.'
              : undergraduates.length > 0
                ? 'Listed from the lab’s own page.'
                : 'Membership is shown for team context only. It is not a recommendation to contact an individual.'}
            {sourceUrl && (
              <>
                {' '}
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel={EXTERNAL_LINK_REL}
                  className="-my-1.5 inline-block py-1.5 font-semibold text-brand underline-offset-4 hover:underline yr-focus-ring"
                >
                  Official roster source
                </a>
              </>
            )}
            {alumniSourceUrl && (
              <>
                {' · '}
                <a
                  href={alumniSourceUrl}
                  target="_blank"
                  rel={EXTERNAL_LINK_REL}
                  className="-my-1.5 inline-block py-1.5 font-semibold text-brand underline-offset-4 hover:underline yr-focus-ring"
                >
                  Alumni page
                </a>
              </>
            )}
          </p>
        )}
        {roster.truncated && (
          <p className="text-xs text-muted">Additional verified members are not shown here.</p>
        )}
      </div>
    </section>
  );
}
