import type { LabMember, LabScholarlyLink } from '../../types/labDetail';
import LabPapersList from './LabPapersList';

const memberDisplayName = (member: LabMember): string =>
  member.user.displayName || [member.user.fname, member.user.lname].filter(Boolean).join(' ');

const groupLinksByMemberKey = (
  links: LabScholarlyLink[],
): Map<string, LabScholarlyLink[]> => {
  const groups = new Map<string, LabScholarlyLink[]>();
  for (const link of links) {
    if (!link.memberKey) continue;
    const existing = groups.get(link.memberKey);
    if (existing) {
      existing.push(link);
    } else {
      groups.set(link.memberKey, [link]);
    }
  }
  return groups;
};

interface LabScholarlyActivitySectionProps {
  scholarlyLinks: LabScholarlyLink[];
  memberScholarlyLinks: LabScholarlyLink[];
  members: LabMember[];
}

const LabScholarlyActivitySection = ({
  scholarlyLinks,
  memberScholarlyLinks,
  members,
}: LabScholarlyActivitySectionProps) => {
  const membersByPublicKey = new Map(
    members.filter((member) => member.user.publicKey).map((member) => [member.user.publicKey as string, member]),
  );
  const groupedMemberLinks = Array.from(groupLinksByMemberKey(memberScholarlyLinks))
    .map(([memberKey, links]) => ({ member: membersByPublicKey.get(memberKey), links }))
    .filter(
      (group): group is { member: LabMember; links: LabScholarlyLink[] } => Boolean(group.member),
    );

  if (scholarlyLinks.length === 0 && groupedMemberLinks.length === 0) return null;

  return (
    <section aria-labelledby="scholarly-activity-heading">
      <h2
        id="scholarly-activity-heading"
        className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-600"
      >
        Scholarly activity
      </h2>
      <div className="space-y-5">
        {scholarlyLinks.length > 0 && <LabPapersList papers={scholarlyLinks} />}
        {groupedMemberLinks.map(({ member, links }) => (
          <div key={member.user.publicKey}>
            <h3 className="mb-2 text-sm font-semibold text-gray-900">{memberDisplayName(member)}</h3>
            <LabPapersList papers={links} />
          </div>
        ))}
      </div>
    </section>
  );
};

export default LabScholarlyActivitySection;
