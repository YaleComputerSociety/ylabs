/**
 * List view row component for browsable listings and fellowships.
 */
import React, { useContext, useMemo } from 'react';
import {
  BrowsableItem,
  getItemId,
  isItemOpen,
  getItemTags,
  getItemSubtitle,
  getItemSubtitleColor,
  getFellowshipJourneySummary,
  getDaysUntilDeadline,
  getItemCardSummary,
  TAG_CAP,
  DESCRIPTION_CLAMP_CLASS,
} from '../../types/browsable';
import StatusBadge from './StatusBadge';
import FavoriteButton from './FavoriteButton';
import UrgentBadge from './UrgentBadge';
import UserContext from '../../contexts/UserContext';
import { useViewTracking } from '../../hooks/useViewTracking';
import { getFellowshipCycleStatus } from '../../utils/fellowshipCycle';
import { programCardFacts } from '../../utils/programBoard';
import { EditIcon } from './icons';

interface BrowseListItemProps {
  item: BrowsableItem;
  isFavorite: boolean;
  onToggleFavorite?: (e: React.MouseEvent) => void;
  onOpenModal: () => void;
  onAdminEdit?: () => void;
  isCompact?: boolean;
}

const BrowseListItem = React.memo(
  ({
    item,
    isFavorite,
    onToggleFavorite,
    onOpenModal,
    onAdminEdit,
    isCompact,
  }: BrowseListItemProps) => {
    const { user } = useContext(UserContext);
    const isAdmin = user?.isAdmin ?? false;
    const open = isItemOpen(item);
    const tags = useMemo(() => getItemTags(item), [item]);
    const trackView = useViewTracking(item.type, getItemId(item));

    const daysUntil = getDaysUntilDeadline(item);
    const urgentBadge =
      item.type === 'fellowship' && daysUntil !== null && daysUntil > 0 && daysUntil <= 14;

    const subtitle = getItemSubtitle(item);
    const subtitleColor = getItemSubtitleColor(item);
    const fellowshipCycleStatus =
      item.type === 'fellowship' ? getFellowshipCycleStatus(item.data) : null;
    const fellowshipJourneySummary =
      item.type === 'fellowship' ? getFellowshipJourneySummary(item.data) : null;

    const isAudited = isAdmin && item.data.audited;
    const programFacts = programCardFacts(item.data);

    const handleClick = () => {
      trackView();
      onOpenModal();
    };

    return (
      <div
        className={`group relative bg-panel rounded-card border ${isAudited ? 'border-green-400 ring-1 ring-green-200' : 'border-line'} hover:border-line-strong hover:shadow-yr-raised active:shadow-none [transition-property:border-color,box-shadow] duration-200`}
      >
        <div className="p-4 grid grid-cols-12 gap-4 items-start">
          <div className={`col-span-12 ${isCompact ? 'md:col-span-10' : 'md:col-span-4'}`}>
            {urgentBadge && daysUntil !== null && (
              <UrgentBadge daysUntil={daysUntil} variant="inline" />
            )}
            <>
              <h3 className="text-sm font-semibold text-ink">
                <button
                  type="button"
                  onClick={handleClick}
                  className="yr-focus-ring -my-3 flex min-h-11 max-w-full items-center text-left after:absolute after:inset-0 after:content-[''] hover:text-brand focus-visible:rounded-control [&:not(:disabled):active]:transform-none [&:not(:disabled):active]:filter-none"
                  aria-label={`View details for ${item.data.title}`}
                >
                  <span className="truncate">{item.data.title}</span>
                </button>
              </h3>
              <p className={`text-xs ${subtitleColor} truncate`}>{subtitle}</p>
              {!isCompact && programFacts.length > 0 && (
                <p className="mt-0.5 truncate text-xs text-ink-soft">{programFacts.join(' · ')}</p>
              )}
            </>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {tags.slice(0, isCompact ? tags.length : TAG_CAP).map((tag) => (
                  <span
                    key={tag.label}
                    className={`${tag.bg} ${tag.text} text-xs px-1.5 py-0.5 rounded-card`}
                  >
                    {tag.label}
                  </span>
                ))}
                {!isCompact && tags.length > TAG_CAP && (
                  <span className="text-xs text-muted">+{tags.length - TAG_CAP}</span>
                )}
              </div>
            )}
          </div>

          {!isCompact && (
            <div className="col-span-6 hidden md:block">
              <p className={`text-sm text-muted ${DESCRIPTION_CLAMP_CLASS}`}>
                {item.data.bestNextStep ||
                  fellowshipJourneySummary ||
                  getItemCardSummary(item) ||
                  item.data.description}
              </p>
            </div>
          )}

          <div className="col-span-12 md:col-span-2 flex md:flex-col items-center md:items-end gap-2 flex-shrink-0">
            <div className="flex items-center gap-1">
              {fellowshipCycleStatus ? (
                <span
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded-card ${fellowshipCycleStatus.className}`}
                >
                  {fellowshipCycleStatus.label}
                </span>
              ) : (
                <StatusBadge isOpen={open} />
              )}
            </div>
            <div className="relative z-[1] flex items-center gap-1">
              {isAdmin && onAdminEdit && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdminEdit();
                  }}
                  className="yr-focus-ring inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-muted hover:text-brand hover:bg-[var(--yr-panel-muted)] transition-colors"
                  title="Edit listing (Admin)"
                  aria-label="Admin edit"
                >
                  <EditIcon size={14} />
                </button>
              )}
              {onToggleFavorite && (
                <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  },
);

BrowseListItem.displayName = 'BrowseListItem';

export default BrowseListItem;
