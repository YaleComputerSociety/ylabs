/**
 * Inquire modal for a research group. Shows a prefilled email template the student
 * can review and send via the OS mail client (mailto: link).
 *
 * Pure presentational — open/close state lives in the page reducer.
 */
import { ResearchGroup } from '../../types/researchGroup';
import { LabContactRoute, LabMember } from '../../types/labDetail';
import { isFacultyResearchEntity } from '../../utils/researchEntityCopy';
import { resolveLabOutreachContact } from '../../utils/labOutreachContact';
import { safeHttpUrl, safeMailtoHref } from '../../utils/url';

interface LabInquireModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: ResearchGroup;
  members: LabMember[];
  contactRoutes?: LabContactRoute[];
  onOfficialRouteOpen?: () => void;
}

const LabInquireModal = ({
  isOpen,
  onClose,
  group,
  members,
  contactRoutes = [],
  onOfficialRouteOpen,
}: LabInquireModalProps) => {
  if (!isOpen) return null;

  const resolvedContact = resolveLabOutreachContact(group, members, contactRoutes);
  const contactEmailHref = safeMailtoHref(resolvedContact?.email);
  const contact = contactEmailHref ? resolvedContact : null;
  const researchHomeLabel = isFacultyResearchEntity(group) ? 'research profile' : 'group';
  const subject = `Inquiry from a Yale undergraduate about research in ${group.name}`;
  const body = contact
    ? `Hello${contact.lname ? ` ${contact.lname}` : ''},\n\nI'm a Yale undergraduate interested in research connected to your ${researchHomeLabel}. I'd love to learn more about how I might contribute to your work on ${
        (group.researchAreas && group.researchAreas[0]) || group.name
      }.\n\nA bit about me:\n  - Year & major:\n  - Relevant coursework:\n  - Why this research home:\n\nWould you have time to chat in the next couple of weeks?\n\nThank you,\n`
    : '';
  const mailto = contact ? safeMailtoHref(contact.email, { subject, body }) : '';
  const officialRoute = contactRoutes.find(
    (route) => route.reviewStatus === 'approved' && safeHttpUrl(route.url),
  );
  const officialRouteUrl = safeHttpUrl(officialRoute?.url);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[1200] flex items-center justify-center overflow-y-auto p-4 pt-20"
      onClick={handleBackdropClick}
    >
      <div className="bg-[var(--yr-panel)] rounded-xl shadow-2xl w-full max-w-xl flex flex-col overflow-hidden">
        <div className="flex items-start justify-between px-6 py-4 border-b border-[var(--yr-line)]">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Inquire about {group.name}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              We've drafted a starter email — review and personalize before sending.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--yr-panel-muted)] text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {!contact ? (
            officialRouteUrl ? (
              <div className="space-y-3 text-sm text-gray-700">
                <p>
                  Yale Research does not release a direct email for this profile. Use the approved
                  official route after reviewing its current instructions.
                </p>
                <div className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] p-3">
                  <p className="font-semibold text-gray-900">
                    {officialRoute?.label || 'Official contact route'}
                  </p>
                  {officialRoute?.rationale && <p className="mt-1">{officialRoute.rationale}</p>}
                  <p className="mt-2 text-xs text-gray-600">
                    Personalize your note with your year, relevant coursework, and a specific
                    connection to this research before submitting it.
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-700">
                No verified contact route is available yet. Administrators review official sources
                before a route appears here.
              </p>
            )
          ) : (
            <>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  To
                </p>
                <p className="text-sm text-gray-800 mt-1">{contact.email}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Subject
                </p>
                <p className="text-sm text-gray-800 mt-1">{subject}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Body
                </p>
                <pre className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-sans bg-[var(--yr-panel-muted)] border border-[var(--yr-line)] rounded-lg p-3 mt-1">
                  {body}
                </pre>
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[var(--yr-line)] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-[var(--yr-panel-muted)] rounded-lg"
          >
            Cancel
          </button>
          {mailto && (
            <a
              href={mailto}
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
            >
              Open in email
            </a>
          )}
          {!mailto && officialRouteUrl && (
            <a
              href={officialRouteUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                onOfficialRouteOpen?.();
                onClose();
              }}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
            >
              Open approved route
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

export default LabInquireModal;
