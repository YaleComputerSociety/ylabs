/**
 * Card view component for browsable listings and fellowships.
 */
import React, { useContext } from 'react';
import { BrowsableItem, getItemTags, getItemSubtitleColor, getDaysUntilDeadline } from '../../types/browsable';
import FavoriteButton from './FavoriteButton';
import ConfigContext from '../../contexts/ConfigContext';
import UserContext from '../../contexts/UserContext';
import { useViewTracking } from '../../hooks/useViewTracking';
import { getDepartmentAbbreviation } from '../../utils/departmentNames';

interface BrowseCardProps {
  item: BrowsableItem;
  isFavorite: boolean;
  onToggleFavorite: (e: React.MouseEvent) => void;
  onOpenModal: () => void;
  onAdminEdit?: () => void;
}

const BrowseCard = React.memo(({ item, isFavorite, onToggleFavorite, onOpenModal, onAdminEdit }: BrowseCardProps) => {
  const { getColorForResearchArea } = useContext(ConfigContext);
  const { user } = useContext(UserContext);
  const isAdmin = user?.userType === 'admin';
  const tags = getItemTags(item, getColorForResearchArea);
  const trackView = useViewTracking(item.type === 'listing' ? 'listing' : 'fellowship', item.data.id);

  const daysUntil = getDaysUntilDeadline(item);
  const showUrgentBanner = item.type === 'fellowship' && daysUntil !== null && daysUntil > 0 && daysUntil <= 14;

  const hasPrerequisites = item.type === 'listing' &&
    item.data.applicantDescription && item.data.applicantDescription.trim() !== '';

  const handleClick = () => {
    trackView();
    onOpenModal();
  };

  const isListing = item.type === 'listing';
  const professorName = isListing
    ? `${item.data.ownerFirstName} ${item.data.ownerLastName}`
    : null;

  const deptLabel = isListing ? (() => {
    const departments = [...(item.data.departments || [])];
    const primary = item.data.ownerPrimaryDepartment;
    if (departments.length === 0) {
      return primary ? getDepartmentAbbreviation(primary) : null;
    }
    if (primary && departments.length > 1) {
      const idx = departments.findIndex(d => d === primary || getDepartmentAbbreviation(d) === getDepartmentAbbreviation(primary));
      if (idx > 0) {
        departments.splice(idx, 1);
        departments.unshift(primary);
      } else if (idx === -1) {
        departments.unshift(primary);
      }
    }
    return departments.map(d => getDepartmentAbbreviation(d)).join(' | ');
  })() : null;

  const fellowshipSubtitle = !isListing ? (() => {
    const { deadline } = item.data;
    if (!deadline) return 'No deadline';
    const d = new Date(deadline);
    if (d < new Date()) return 'Deadline passed';
    return `Due ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  })() : null;
  const subtitleColor = getItemSubtitleColor(item);

  const isAudited = isAdmin && item.data.audited;

  return (
    <div
      className={`group relative bg-white rounded-lg border ${isAudited ? 'border-green-400 ring-1 ring-green-200' : 'border-gray-200'} hover:border-blue-400 hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden h-full flex flex-col`}
      onClick={handleClick}
    >
      {showUrgentBanner && (
        <div className="bg-amber-50 border-b border-amber-200 px-3 py-1.5">
          <p className="text-sm font-medium text-amber-700">
            {daysUntil === 1 ? 'Due tomorrow' : `${daysUntil} days left`}
          </p>
        </div>
      )}

      <div className="p-5 flex-1 flex flex-col">
        <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
          {hasPrerequisites && (
            <div className="relative group/tip">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#9ca3af"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="hover:stroke-amber-600 transition-colors"
              >
                <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
                <path d="M9 17h6" />
                <path d="M9 13h6" />
              </svg>
              <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800/75 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover/tip:opacity-100 transition-opacity pointer-events-none z-20">
                Has Application Details
              </span>
            </div>
          )}
          {isAdmin && onAdminEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAdminEdit();
              }}
              className="p-1 rounded-full text-gray-300 hover:text-blue-600 transition-colors"
              aria-label="Admin edit"
              title={`Edit ${item.type} (Admin)`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          )}
          <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
        </div>

        {isListing ? (
          <>
            {deptLabel && (
              <p className="text-sm font-semibold text-blue-700 mb-1 truncate">
                {deptLabel}
              </p>
            )}

            <h3 className="text-base font-bold text-gray-900 leading-tight">
              {professorName}
            </h3>

            <p className="text-sm text-gray-600 mb-2 line-clamp-2 leading-snug">
              {item.data.title}
            </p>

            {tags.length > 0 && (
              <div className="border-t border-gray-100 my-2" />
            )}

            <div className="flex-1" />

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag.label}
                    className={`${tag.bg} ${tag.text} text-xs px-1.5 py-0.5 rounded`}
                  >
                    {tag.label}
                  </span>
                ))}
                {tags.length > 3 && (
                  <span className="text-xs text-gray-400">
                    +{tags.length - 3}
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

            <p className={`text-sm mb-2 ${subtitleColor}`}>
              {fellowshipSubtitle}
            </p>

            <div className="flex-1" />

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag.label}
                    className={`${tag.bg} ${tag.text} text-xs px-1.5 py-0.5 rounded`}
                  >
                    {tag.label}
                  </span>
                ))}
                {tags.length > 3 && (
                  <span className="text-xs text-gray-400">
                    +{tags.length - 3}
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
