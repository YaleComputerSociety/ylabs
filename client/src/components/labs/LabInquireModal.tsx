/**
 * Inquire modal for a research group. Shows a prefilled email template the student
 * can review and send via the OS mail client (mailto: link).
 *
 * Pure presentational — open/close state lives in the page reducer.
 */
import { ResearchGroup } from '../../types/researchGroup';
import { LabMember } from '../../types/labDetail';

interface LabInquireModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: ResearchGroup;
  members: LabMember[];
}

const resolveContact = (
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

const LabInquireModal = ({ isOpen, onClose, group, members }: LabInquireModalProps) => {
  if (!isOpen) return null;

  const contact = resolveContact(group, members);
  const subject = `Inquiry from a Yale undergraduate about research in ${group.name}`;
  const body = contact
    ? `Hi Professor ${contact.lname || ''},\n\nI'm a Yale undergraduate interested in research in your group. I'd love to learn more about how I might contribute to your work on ${
        (group.researchAreas && group.researchAreas[0]) || group.name
      }.\n\nA bit about me:\n  - Year & major:\n  - Relevant coursework:\n  - Why your lab:\n\nWould you have time to chat in the next couple of weeks?\n\nThank you,\n`
    : '';
  const mailto = contact
    ? `mailto:${contact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : '';

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[1200] flex items-center justify-center overflow-y-auto p-4 pt-20"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl flex flex-col overflow-hidden">
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Inquire about {group.name}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              We've drafted a starter email — review and personalize before sending.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
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
            <p className="text-sm text-gray-700">
              We don't have a public contact email for this research group yet. Try the website
              or check back later.
            </p>
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
                <pre className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-sans bg-gray-50 border border-gray-100 rounded-lg p-3 mt-1">
                  {body}
                </pre>
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
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
        </div>
      </div>
    </div>
  );
};

export default LabInquireModal;
