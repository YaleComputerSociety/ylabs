/**
 * Displays a developer profile card with photo, name, position, and social links.
 */
import { Developer } from '../types/types';
import { safeUrl } from '../utils/url';

interface DeveloperCardProps {
  developer: Developer;
}

const DeveloperCard = ({ developer }: DeveloperCardProps) => {
  if (!developer) {
    return null;
  }

  const iconLinkClass =
    'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md transition hover:bg-[var(--yr-panel-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';
  const websiteHref = safeUrl(developer.website);
  const linkedinHref = safeUrl(developer.linkedin);
  const githubHref = safeUrl(developer.github);
  const hasProfileLinks = Boolean(websiteHref || linkedinHref || githubHref);

  return (
    <div>
      <img
        src={developer.image ? developer.image : '/assets/developers/no-user.png'}
        alt={`${developer.name} Profile Picture`}
        className="aspect-square object-cover w-full rounded-lg mb-2"
        width={500}
        height={500}
      />
      <h3 className="text-xl font-semibold">{developer.name}</h3>
      <p className="text-gray-700">{developer.position}</p>
      <p className="text-gray-700 mb-1">{developer.location}</p>
      {hasProfileLinks && (
        <div className="mt-2 flex flex-wrap justify-center gap-1">
          {websiteHref && (
            <a
              href={websiteHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${developer.name} Website`}
              className={iconLinkClass}
            >
              <img
                src="/assets/icons/website-icon.png"
                alt={`${developer.name} Website`}
                width={20}
                height={20}
                className="block"
              />
            </a>
          )}
          {linkedinHref && (
            <a
              href={linkedinHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${developer.name} LinkedIn`}
              className={iconLinkClass}
            >
              <img
                src="/assets/icons/linkedin-icon.png"
                alt={`${developer.name} LinkedIn`}
                width={28}
                height={28}
                className="block"
              />
            </a>
          )}
          {githubHref && (
            <a
              href={githubHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${developer.name} GitHub`}
              className={iconLinkClass}
            >
              <img
                src="/assets/icons/github-icon.png"
                alt={`${developer.name} GitHub`}
                width={20}
                height={20}
                className="block"
              />
            </a>
          )}
        </div>
      )}
    </div>
  );
};

export default DeveloperCard;
