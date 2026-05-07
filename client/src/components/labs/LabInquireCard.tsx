/**
 * "Inquire" CTA panel for a research group. Shows undergrad-relevant context
 * (typical roles, prereqs, time commitment, credit options, funding) and
 * an action button:
 *   - openness === 'open' AND a contact email exists → "Inquire" (opens modal)
 *   - otherwise → "Email PI" mailto fallback if any email is available
 *
 * Below the CTA we render an "Evidence" section that mirrors the trust
 * gradient on the header: each scraper-derived signal becomes a chip with a
 * tooltip-like detail. Plus we show three "lab is real and active" credibility
 * lines: recent grants summary, paper count, and past advisees.
 *
 * Pure presentational. The page owns the modal state (via the reducer).
 */
import { ResearchGroup } from '../../types/researchGroup';
import { LabMember } from '../../types/labDetail';
import {
  computeAcceptanceVerdict,
  EvidenceItem,
  verdictBadgeStyles,
  verdictLabel,
} from '../../utils/undergradAcceptance';

interface LabInquireCardProps {
  group: ResearchGroup;
  members: LabMember[];
  /** Whether the lab has at least one non-archived listing. */
  hasActiveListing?: boolean;
  onInquire: () => void;
}

// Resolve the best email for an "Email PI" mailto: prefer the explicit
// contactEmail on the group, otherwise the first PI/director member's email.
const resolvePiEmail = (
  group: ResearchGroup,
  members: LabMember[],
): { email: string; lname: string } | null => {
  if (group.contactEmail) {
    const piMember = members.find((m) => m.role === 'pi' || m.role === 'director');
    return {
      email: group.contactEmail,
      lname: piMember?.user.lname || group.contactName || '',
    };
  }
  const pi =
    members.find((m) => m.role === 'pi' || m.role === 'director') ||
    members.find((m) => m.role === 'co-pi' || m.role === 'co-director') ||
    members[0];
  if (pi && pi.user.email) {
    return { email: pi.user.email, lname: pi.user.lname };
  }
  return null;
};

const formatHours = (group: ResearchGroup): string | null => {
  const t = group.timeCommitmentHoursPerWeek;
  if (!t) return null;
  if (t.min !== undefined && t.max !== undefined) return `${t.min}–${t.max} hrs/week`;
  if (t.min !== undefined) return `From ${t.min} hrs/week`;
  if (t.max !== undefined) return `Up to ${t.max} hrs/week`;
  return null;
};

/**
 * Summarize recent grants like "Funded: 2x NIH R01, 1x NSF". We bucket by
 * agency since the chip is meant to convey breadth, not specific awards.
 */
const formatGrantSummary = (group: ResearchGroup): string | null => {
  const grants = group.recentGrants || [];
  if (grants.length === 0) return null;
  const counts: Record<string, number> = {};
  for (const g of grants) {
    const agency = (g.agency || '').trim();
    if (!agency) continue;
    counts[agency] = (counts[agency] || 0) + 1;
  }
  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([agency, n]) => `${n}× ${agency}`);
  if (parts.length === 0) return null;
  return `Funded: ${parts.join(', ')}`;
};

interface EvidenceChipProps {
  item: EvidenceItem;
}

const EvidenceChip = ({ item }: EvidenceChipProps) => {
  // Strong = filled, moderate = soft. Keeps the visual weight aligned with the
  // verdict computation.
  const tone =
    item.strength === 'strong'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : 'bg-blue-50 text-blue-700 border-blue-100';
  const negativeTone = 'bg-red-50 text-red-700 border-red-100';
  const isNegative = item.kind === 'closed-toggle' || item.kind === 'closed-evidence';
  const cls = isNegative ? negativeTone : tone;
  return (
    <span
      title={item.detail}
      className={`inline-flex items-center gap-1 text-xs rounded-md border px-2 py-1 ${cls}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {isNegative ? (
          <>
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </>
        ) : (
          <>
            <polyline points="20 6 9 17 4 12" />
          </>
        )}
      </svg>
      <span>{item.label}</span>
    </span>
  );
};

const LabInquireCard = ({
  group,
  members,
  hasActiveListing = false,
  onInquire,
}: LabInquireCardProps) => {
  const piContact = resolvePiEmail(group, members);
  const canInquireInline = group.openness === 'open' && !!group.contactEmail;
  const hours = formatHours(group);
  const { verdict, evidence } = computeAcceptanceVerdict(group, hasActiveListing);

  // Mailto for the fallback path (no inline-inquire flow).
  const fallbackMailto = piContact
    ? `mailto:${piContact.email}?subject=${encodeURIComponent(
        `Inquiry from a Yale undergraduate about research in ${group.name}`,
      )}&body=${encodeURIComponent(
        `Hi Professor ${piContact.lname || ''},\n\nI'm a Yale undergraduate interested in research in your group. I'd love to learn more about how I might contribute.\n\nThank you,\n`,
      )}`
    : '';

  const grantSummary = formatGrantSummary(group);
  const paperCount = group.recentPaperCount ?? 0;
  const indepCourses = (group.independentStudyCourses || [])
    .map((c) => (c?.code || '').trim())
    .filter((s) => s.length > 0);
  const pastAdviseesTotal = (group.pastUndergradAdvisees || []).reduce(
    (sum, p) => sum + (p?.count ?? 1),
    0,
  );
  const pastAdviseesYears = (group.pastUndergradAdvisees || [])
    .map((p) => p?.year)
    .filter((y): y is number => typeof y === 'number' && y > 0)
    .sort((a, b) => a - b);
  const pastAdviseesRange =
    pastAdviseesYears.length > 0
      ? pastAdviseesYears[0] === pastAdviseesYears[pastAdviseesYears.length - 1]
        ? `${pastAdviseesYears[0]}`
        : `${pastAdviseesYears[0]}–${pastAdviseesYears[pastAdviseesYears.length - 1]}`
      : null;

  return (
    <div className="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50/60 to-white p-5 shadow-sm">
      <h3 className="text-base font-bold text-gray-900">Interested in joining?</h3>
      <p className="text-sm text-gray-600 mt-1">
        {canInquireInline
          ? "Send a quick message to introduce yourself — we'll prefill the basics."
          : group.openness === 'closed'
            ? "This research group isn't accepting new undergraduates right now."
            : 'Reach out to the PI directly to ask about getting involved.'}
      </p>

      <div className="mt-4 space-y-3">
        {group.typicalUndergradRoles && group.typicalUndergradRoles.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Typical undergrad roles
            </p>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {group.typicalUndergradRoles.map((role) => (
                <span
                  key={role}
                  className="text-xs bg-blue-50 text-blue-700 rounded-md px-2 py-1"
                >
                  {role}
                </span>
              ))}
            </div>
          </div>
        )}

        {group.prerequisiteCourses && group.prerequisiteCourses.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Prerequisite courses
            </p>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {group.prerequisiteCourses.map((c) => (
                <span
                  key={c}
                  className="text-xs bg-amber-50 text-amber-700 rounded-md px-2 py-1"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {group.creditOptions && group.creditOptions.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Credit options
            </p>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {group.creditOptions.map((c) => (
                <span
                  key={c}
                  className="text-xs bg-purple-50 text-purple-700 rounded-md px-2 py-1"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {group.fundingPrograms && group.fundingPrograms.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Funding programs
            </p>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {group.fundingPrograms.map((c) => (
                <span
                  key={c}
                  className="text-xs bg-green-50 text-green-700 rounded-md px-2 py-1"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {hours && (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>{hours}</span>
          </div>
        )}
      </div>

      <div className="mt-5">
        {canInquireInline ? (
          <button
            onClick={onInquire}
            className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
          >
            Inquire about joining
          </button>
        ) : fallbackMailto ? (
          <a
            href={fallbackMailto}
            className="block w-full text-center px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
          >
            Email PI
          </a>
        ) : (
          <p className="text-xs text-gray-500 text-center">
            No contact information available yet.
          </p>
        )}
        {group.contactEmail && group.contactName && (
          <p className="text-xs text-gray-500 text-center mt-2">
            Contact: {group.contactName}
            {group.contactRole ? ` (${group.contactRole})` : ''}
          </p>
        )}
      </div>

      {(evidence.length > 0 ||
        grantSummary ||
        paperCount > 0 ||
        indepCourses.length > 0 ||
        pastAdviseesTotal > 0) && (
        <div
          className="mt-5 pt-4 border-t border-blue-100"
          aria-label="Evidence supporting the acceptance signal"
        >
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              Evidence
            </p>
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${verdictBadgeStyles(
                verdict,
              )}`}
            >
              {verdictLabel(verdict)}
            </span>
          </div>

          {evidence.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {evidence.slice(0, 4).map((item, i) => (
                <EvidenceChip key={`${item.kind}-${i}`} item={item} />
              ))}
            </div>
          )}

          <ul className="mt-3 space-y-1 text-xs text-gray-600">
            {grantSummary && <li>• {grantSummary}</li>}
            {paperCount > 0 && (
              <li>
                • Published {paperCount} {paperCount === 1 ? 'paper' : 'papers'} in last 24
                months
              </li>
            )}
            {indepCourses.length > 0 && (
              <li>• Offers {indepCourses.join(', ')}</li>
            )}
            {pastAdviseesTotal > 0 && (
              <li>
                • Advised {pastAdviseesTotal}{' '}
                {pastAdviseesTotal === 1 ? 'undergrad' : 'undergrads'}
                {pastAdviseesRange ? ` (${pastAdviseesRange})` : ''}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

export default LabInquireCard;
