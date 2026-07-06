/**
 * List view row component for browsable listings and fellowships.
 */
import React, { useContext } from 'react';
import {
  BrowsableItem,
  isItemOpen,
  getItemTags,
  getItemSubtitle,
  getItemSubtitleColor,
  getDaysUntilDeadline,
} from '../../types/browsable';
import StatusBadge from './StatusBadge';
import FavoriteButton from './FavoriteButton';
import ConfigContext from '../../contexts/ConfigContext';
import UserContext from '../../contexts/UserContext';
import { useViewTracking } from '../../hooks/useViewTracking';
import { getDepartmentAbbreviation } from '../../utils/departmentNames';

interface BrowseListItemProps {
  item: BrowsableItem;
  isFavorite: boolean;
  onToggleFavorite: (e: React.MouseEvent) => void;
  onOpenModal: () => void;
  onAdminEdit?: () => void;
}

const BrowseListItem = React.memo(
  ({ item, isFavorite, onToggleFavorite, onOpenModal, onAdminEdit }: BrowseListItemProps) => {
    const { getColorForResearchArea } = useContext(ConfigContext);
    const { user } = useContext(UserContext);
    const isAdmin = user?.userType === 'admin';
    const open = isItemOpen(item);
    const tags = getItemTags(item, getColorForResearchArea);
    const trackView = useViewTracking(
      item.type === 'listing' ? 'listing' : 'fellowship',
      item.data.id,
    );

    const hasPrerequisites =
      item.type === 'listing' &&
      item.data.applicantDescription &&
      item.data.applicantDescription.trim() !== '';

    const daysUntil = getDaysUntilDeadline(item);
    const urgentBadge =
      item.type === 'fellowship' && daysUntil !== null && daysUntil > 0 && daysUntil <= 14;

    const handleClick = () => {
      trackView();
      onOpenModal();
    };

    const deptLabel =
      item.type === 'listing'
        ? (() => {
            const departments = [...(item.data.departments || [])];
            const primary = item.data.ownerPrimaryDepartment;
            if (departments.length === 0) {
              return primary ? getDepartmentAbbreviation(primary) : null;
            }
            if (primary && departments.length > 1) {
              const idx = departments.findIndex(
                (d) =>
                  d === primary ||
                  getDepartmentAbbreviation(d) === getDepartmentAbbreviation(primary),
              );
              if (idx > 0) {
                departments.splice(idx, 1);
                departments.unshift(primary);
              } else if (idx === -1) {
                departments.unshift(primary);
              }
            }
            return departments
              .slice(0, 3)
              .map((d) => getDepartmentAbbreviation(d))
              .join(' | ');
          })()
        : null;

    const subtitle = getItemSubtitle(item);
    const subtitleColor = getItemSubtitleColor(item);

    const isAudited = isAdmin && item.data.audited;

    return (
      <div
        className={`group bg-white rounded-md border ${isAudited ? 'border-green-400 ring-1 ring-green-200' : 'border-gray-200'} hover:border-blue-400 hover:shadow-sm transition-all duration-200 cursor-pointer`}
        onClick={handleClick}
      >
        <div className="p-4 grid grid-cols-12 gap-4 items-start">
          <div className="col-span-12 md:col-span-4">
            {deptLabel && (
              <span className="text-xs font-semibold text-blue-700 block mb-0.5 truncate">
                {deptLabel}
              </span>
            )}
            {urgentBadge && (
              <span className="text-xs font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded mb-1 inline-block">
                {daysUntil === 1 ? 'Due tomorrow' : `${daysUntil} days left`}
              </span>
            )}
            <h3 className="text-sm font-semibold text-gray-900 truncate">{item.data.title}</h3>
            <p className={`text-xs ${subtitleColor} truncate`}>{subtitle}</p>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag.label}
                    className={`${tag.bg} ${tag.text} text-xs px-1.5 py-0.5 rounded`}
                  >
                    {tag.label}
                  </span>
                ))}
                {tags.length > 3 && (
                  <span className="text-xs text-gray-400">+{tags.length - 3}</span>
                )}
              </div>
            )}
          </div>

          <div className="col-span-6 hidden md:block">
            <p className="text-sm text-gray-600 line-clamp-3">{item.data.description}</p>
          </div>

          <div className="col-span-12 md:col-span-2 flex md:flex-col items-center md:items-end gap-2">
            <div className="flex items-center gap-1">
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
              <StatusBadge isOpen={open} />
            </div>
            <div className="flex items-center gap-1">
              {isAdmin && onAdminEdit && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdminEdit();
                  }}
                  className="p-1 rounded-full text-gray-300 hover:text-blue-600 transition-colors"
                  title="Edit listing (Admin)"
                >
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
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              )}
              <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
            </div>
            <p className="text-[10px] text-gray-400 hidden md:block">
              Added {new Date(item.data.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>
    );
  },
);

BrowseListItem.displayName = 'BrowseListItem';

export default BrowseListItem;
