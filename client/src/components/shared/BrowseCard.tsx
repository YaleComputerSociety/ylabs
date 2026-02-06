import React, { useContext } from 'react';
import { BrowsableItem, isItemOpen, getItemTags, getItemSubtitle, getItemSubtitleColor, getDaysUntilDeadline } from '../../types/browsable';
import StatusBadge from './StatusBadge';
import FavoriteButton from './FavoriteButton';
import ConfigContext from '../../contexts/ConfigContext';
import UserContext from '../../contexts/UserContext';
import { useViewTracking } from '../../hooks/useViewTracking';

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
  const open = isItemOpen(item);
  const tags = getItemTags(item, getColorForResearchArea);
  const subtitle = getItemSubtitle(item);
  const subtitleColor = getItemSubtitleColor(item);
  const trackView = useViewTracking(item.type === 'listing' ? 'listing' : 'fellowship', item.data.id);

  const daysUntil = getDaysUntilDeadline(item);
  const showUrgentBanner = item.type === 'fellowship' && daysUntil !== null && daysUntil > 0 && daysUntil <= 14;

  const hasPrerequisites = item.type === 'listing' &&
    item.data.applicantDescription && item.data.applicantDescription.trim() !== '';

  const handleClick = () => {
    trackView();
    onOpenModal();
  };

  return (
    <div
      className="group relative bg-white rounded-lg border border-gray-200 hover:border-blue-400 hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden h-full flex flex-col"
      onClick={handleClick}
    >
      {/* Urgent Banner for fellowships */}
      {showUrgentBanner && (
        <div className="bg-amber-50 border-b border-amber-200 px-3 py-1">
          <p className="text-xs font-medium text-amber-700">
            {daysUntil === 1 ? 'Due tomorrow' : `${daysUntil} days left`}
          </p>
        </div>
      )}

      <div className="p-4 flex-1 flex flex-col">
        {/* Top Row: Status Badge + Actions */}
        <div className="flex items-center justify-between mb-2">
          <StatusBadge isOpen={open} />
          <div className="flex items-center gap-1">
            {/* Application details icon with tooltip (listings only) */}
            {hasPrerequisites && (
              <div className="relative group/tip">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
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
            {/* Admin edit button */}
            {isAdmin && item.type === 'listing' && onAdminEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAdminEdit();
                }}
                className="p-1 rounded-full text-gray-300 hover:text-blue-600 transition-colors"
                aria-label="Admin edit"
                title="Edit listing (Admin)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            )}
            <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
          </div>
        </div>

        {/* Title */}
        <h3 className="text-sm font-semibold text-gray-900 mb-1 line-clamp-2 leading-tight">
          {item.data.title}
        </h3>

        {/* Subtitle */}
        <p className={`text-xs mb-2 ${subtitleColor}`}>
          {subtitle}
        </p>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Tags - Show max 2 */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 2).map((tag) => (
              <span
                key={tag.label}
                className={`${tag.bg} ${tag.text} text-xs px-1.5 py-0.5 rounded`}
              >
                {tag.label}
              </span>
            ))}
            {tags.length > 2 && (
              <span className="text-xs text-gray-400">
                +{tags.length - 2}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

BrowseCard.displayName = 'BrowseCard';

export default BrowseCard;
