import type { LabMember, LabMemberRole } from '../../types/labDetail';
import { principalInvestigatorLinkFromMemberUser } from '../../utils/principalInvestigatorLinks';
import { EXTERNAL_LINK_REL } from '../../utils/url';

const MAX_PRESENTED_TEAM_MEMBERS = 24;

const GROUPS: Array<{ role: LabMemberRole; label: string }> = [
  { role: 'postdoc', label: 'Postdoctoral researchers' },
  { role: 'grad-student', label: 'Graduate students' },
  { role: 'undergrad', label: 'Undergraduate researchers' },
  { role: 'staff', label: 'Research staff' },
  { role: 'core-faculty', label: 'Faculty' },
  { role: 'affiliated', label: 'Other current members' },
];

const TEAM_ROLES = new Set<LabMemberRole>(GROUPS.map((group) => group.role));

const displayName = (member: LabMember): string =>
  member.user.displayName || [member.user.fname, member.user.lname].filter(Boolean).join(' ');

export default function ResearchTeamSection({ members }: { members: LabMember[] }) {
  const teamMembers = members.filter((member) => TEAM_ROLES.has(member.role));
  const presentedMembers = teamMembers.slice(0, MAX_PRESENTED_TEAM_MEMBERS);

  return (
    <section aria-labelledby="research-team-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="research-team-heading"
          className="text-xs font-semibold uppercase tracking-wider text-gray-600"
        >
          Current research team
        </h2>
      </div>

      {presentedMembers.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--yr-line)] bg-[var(--yr-panel)] px-4 py-5">
          <p className="text-sm leading-relaxed text-gray-700">
            No current team members are listed for this research home. This does not mean the team
            is empty.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {GROUPS.map(({ role, label }) => {
            const groupedMembers = presentedMembers.filter((member) => member.role === role);
            if (groupedMembers.length === 0) return null;
            return (
              <div key={role}>
                <h3 className="mb-2 text-sm font-semibold text-gray-900">{label}</h3>
                <ul className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                  {groupedMembers.map((member) => {
                    const name = displayName(member);
                    const link = principalInvestigatorLinkFromMemberUser(
                      member.user as unknown as Record<string, unknown>,
                    );
                    const externalLink = link?.external ? link : undefined;
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
                        {externalLink ? (
                          <a
                            href={externalLink.href}
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
          </p>
          {teamMembers.length > presentedMembers.length && (
            <p className="text-xs text-gray-500">Additional current members are not shown here.</p>
          )}
        </div>
      )}
    </section>
  );
}
