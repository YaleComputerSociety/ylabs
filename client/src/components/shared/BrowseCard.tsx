/**
 * Card view component for browsable listings and fellowships.
 */
import React, { useContext, useMemo } from 'react';
import {
  BrowsableItem,
  getItemTags,
  getItemSubtitle,
  getItemSubtitleColor,
  getDaysUntilDeadline,
  getOrderedDeptAbbrs,
  DEPT_CAP,
  TAG_CAP,
  DESCRIPTION_CLAMP_CLASS,
} from '../../types/browsable';
import FavoriteButton from './FavoriteButton';
import HasPrerequisitesIcon from './HasPrerequisitesIcon';
import UrgentBadge from './UrgentBadge';
import ArchivedBadge from './ArchivedBadge';
import ConfigContext from '../../contexts/ConfigContext';
import UserContext from '../../contexts/UserContext';
import { useViewTracking } from '../../hooks/useViewTracking';

interface BrowseCardProps {
  item: BrowsableItem;
  isFavorite: boolean;
  onToggleFavorite: (e: React.MouseEvent) => void;
  onOpenModal: () => void;
  onAdminEdit?: () => void;
  isCompact?: boolean;
}

const BrowseCard = React.memo(({ item, isFavorite, onToggleFavorite, onOpenModal, onAdminEdit, isCompact }: BrowseCardProps) => {
  const { getColorForResearchArea } = useContext(ConfigContext);
  const { user } = useContext(UserContext);
  const isAdmin = user?.userType === 'admin';
  const tags = useMemo(() => getItemTags(item, getColorForResearchArea), [item, getColorForResearchArea]);
  const trackView = useViewTracking(item.type === 'listing' ? 'listing' : 'fellowship', item.data.id);

  const daysUntil = getDaysUntilDeadline(item);
  const showUrgentBanner = item.type === 'fellowship' && daysUntil !== null && daysUntil > 0 && daysUntil <= 14;

  const hasPrerequisites = item.type === 'listing' &&
    !!item.data.applicantDescription && item.data.applicantDescription.trim() !== '';

  const isListing = item.type === 'listing';
  const professorName = isListing
    ? `${item.data.ownerFirstName} ${item.data.ownerLastName}`
    : null;
  const isArchived = isListing && item.data.archived;

  const deptInfo = useMemo(() => {
    if (!isListing) return null;
    return getOrderedDeptAbbrs(item.data.departments, item.data.ownerPrimaryDepartment, DEPT_CAP);
  }, [item, isListing]);

  const deptLabel = deptInfo && deptInfo.abbrs.length > 0
    ? deptInfo.abbrs.join(' | ') + (deptInfo.truncated > 0 ? ` +${deptInfo.truncated}` : '')
    : null;

  const subtitle = getItemSubtitle(item);
  const subtitleColor = getItemSubtitleColor(item);

  const isAudited = isAdmin && item.data.audited;

  const handleClick = () => {
    trackView();
    onOpenModal();
  };

  return (
    <div
      className={`group relative bg-white rounded-md border ${isAudited ? 'border-green-400 ring-1 ring-green-200' : 'border-gray-200'} hover:border-blue-400 hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden h-full flex flex-col ${isArchived ? 'opacity-75' : ''}`}
      onClick={handleClick}
    >
      {showUrgentBanner && daysUntil !== null && (
        <UrgentBadge daysUntil={daysUntil} variant="banner" />
      )}

      <div className="p-5 flex-1 flex flex-col">
        <div className="absolute top-2 right-2 flex items-center gap-1 z-10 flex-shrink-0">
          {hasPrerequisites && <HasPrerequisitesIcon />}
          {isAdmin && onAdminEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAdminEdit();
              }}
              className="p-1 rounded-full text-gray-500 hover:text-blue-600 hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="Admin edit"
              title={`Edit ${item.type} (Admin)`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          )}
          <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
        </div>

        {isListing ? (
          <>
            <div className="flex items-center gap-2 mb-1">
              {deptLabel && (
                <p className="text-sm font-semibold text-blue-700 truncate">
                  {deptLabel}
                </p>
              )}
              {isArchived && <ArchivedBadge />}
            </div>

            <h3 className="text-base font-bold text-gray-900 leading-tight">
              {professorName}
            </h3>

            <p className="text-sm text-gray-600 mb-1 line-clamp-2 leading-snug">
              {item.data.title}
            </p>

            {item.data.description && !isCompact && (
              <p className={`text-sm text-gray-500 mb-2 leading-snug ${DESCRIPTION_CLAMP_CLASS}`}>
                {item.data.description}
              </p>
            )}

            {tags.length > 0 && !isCompact && (
              <div className="border-t border-gray-100 my-2" />
            )}

            <div className="flex-1" />

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.slice(0, isCompact ? tags.length : TAG_CAP).map((tag) => (
                  <span
                    key={tag.label}
                    className={`${tag.bg} ${tag.text} text-xs px-1.5 py-0.5 rounded`}
                  >
                    {tag.label}
                  </span>
                ))}
                {!isCompact && tags.length > TAG_CAP && (
                  <span className="text-xs text-gray-400">
                    +{tags.length - TAG_CAP}
                  </span>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <h3 className="text-base font-bold text-gray-900 mb-1 line-clamp-2 leading-tight">
              {item.data.title}
            </h3>

            <p className={`text-sm mb-1 ${subtitleColor}`}>
              {subtitle}
            </p>

            {item.data.summary && !isCompact && (
              <p className={`text-sm text-gray-500 mb-2 leading-snug ${DESCRIPTION_CLAMP_CLASS}`}>
                {item.data.summary}
              </p>
            )}

            <div className="flex-1" />

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.slice(0, isCompact ? tags.length : TAG_CAP).map((tag) => (
                  <span
                    key={tag.label}
                    className={`${tag.bg} ${tag.text} text-xs px-1.5 py-0.5 rounded`}
                  >
                    {tag.label}
                  </span>
                ))}
                {!isCompact && tags.length > TAG_CAP && (
                  <span className="text-xs text-gray-400">
                    +{tags.length - TAG_CAP}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});

BrowseCard.displayName = 'BrowseCard';

export default BrowseCard;
