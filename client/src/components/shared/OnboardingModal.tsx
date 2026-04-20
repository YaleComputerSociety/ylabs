/**
 * Forced onboarding modal for faculty who haven't self-verified their profile.
 * Cannot be dismissed; the professor must verify department + research interests
 * via the embedded ProfileEditor before they can use the rest of the app.
 */
import { useContext, useEffect } from 'react';
import UserContext from '../../contexts/UserContext';
import ProfileEditor from '../accounts/ProfileEditor';

const FACULTY_TYPES = new Set(['professor', 'faculty']);

const OnboardingModal = () => {
  const { user, isLoading, checkContext } = useContext(UserContext);

  const isActive =
    !isLoading && !!user && FACULTY_TYPES.has(user.userType) && !user.selfVerified;

  useEffect(() => {
    if (!isActive) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isActive]);

  if (!isActive) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[1300] flex items-start justify-center overflow-y-auto p-4 pt-12"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl flex flex-col overflow-hidden max-h-[90vh]">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 id="onboarding-title" className="text-lg font-bold text-gray-900">
            Welcome — please verify your profile
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            We've auto-populated your profile from Yale directories. Review the
            information below and confirm your primary department and research
            interests to continue using the site.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <ProfileEditor netid={user!.netId} onVerified={checkContext} />
        </div>
      </div>
    </div>
  );
};

export default OnboardingModal;
