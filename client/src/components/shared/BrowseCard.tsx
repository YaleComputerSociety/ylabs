/**
 * Card view component for browsable fellowships.
 */
import React, { useContext, useMemo } from 'react';
import {
  BrowsableItem,
  getItemId,
  getItemTags,
  getItemSubtitle,
  getItemSubtitleColor,
  getDaysUntilDeadline,
  getItemCardSummary,
  FELLOWSHIP_TAG_CAP,
  DESCRIPTION_CLAMP_CLASS,
} from '../../types/browsable';
import ArrowRightIcon from './ArrowRightIcon';
import FavoriteButton from './FavoriteButton';
import UrgentBadge from './UrgentBadge';
import UserContext from '../../contexts/UserContext';
import { useViewTracking } from '../../hooks/useViewTracking';
import { getFellowshipCycleStatus } from '../../utils/fellowshipCycle';
import { programCardFacts } from '../../utils/programBoard';
import { EditIcon } from './icons';

const ICON_BUTTON_SIZE = 44;
const ICON_BUTTON_GAP = 4;
const ICON_CLUSTER_OFFSET = 8;
const CARD_PADDING = 20;

interface BrowseCardProps {
  item: BrowsableItem;
  isFavorite: boolean;
  onToggleFavorite?: (e: React.MouseEvent) => void;
  onOpenModal: () => void;
  onAdminEdit?: () => void;
  isCompact?: boolean;
}

const BrowseCard = React.memo(
  ({
    item,
    isFavorite,
    onToggleFavorite,
    onOpenModal,
    onAdminEdit,
    isCompact,
  }: BrowseCardProps) => {
    const { user } = useContext(UserContext);
    const isAdmin = user?.isAdmin ?? false;
    const tags = useMemo(() => getItemTags(item), [item]);
    const trackView = useViewTracking(item.type, getItemId(item));

    const daysUntil = getDaysUntilDeadline(item);
    const showUrgentBanner =
      item.type === 'fellowship' && daysUntil !== null && daysUntil > 0 && daysUntil <= 14;

    const subtitle = getItemSubtitle(item);
    const subtitleColor = getItemSubtitleColor(item);
    const fellowshipCycleStatus =
      item.type === 'fellowship' ? getFellowshipCycleStatus(item.data) : null;
    const fellowshipNextStep =
      item.type === 'fellowship' ? item.data.bestNextStep?.trim() || null : null;
    const fellowshipFacts = item.type === 'fellowship' ? programCardFacts(item.data) : [];

    const isAudited = isAdmin && item.data.audited;

    const iconClusterCount = (isAdmin && onAdminEdit ? 1 : 0) + (onToggleFavorite ? 1 : 0);
    const iconClusterClearance =
      iconClusterCount > 0
        ? Math.max(
            0,
            ICON_CLUSTER_OFFSET +
              iconClusterCount * ICON_BUTTON_SIZE +
              (iconClusterCount - 1) * ICON_BUTTON_GAP -
              CARD_PADDING,
          )
        : 0;

    const handleClick = () => {
      trackView();
      onOpenModal();
    };

    return (
      <div
        className={`yr-card-interactive group relative rounded-card ${isAudited ? 'border-green-400 ring-1 ring-green-200' : ''} overflow-hidden h-full flex flex-col`}
      >
        {showUrgentBanner && daysUntil !== null && (
          <UrgentBadge daysUntil={daysUntil} variant="banner" />
        )}

        {/* Zero-height anchor: the icon cluster must hang below the urgency banner
            rather than straddle it, and the card root must stay the containing block
            for the whole-card click overlay on "View details". */}
        <div className="relative z-10">
          <div className="absolute top-2 right-2 flex items-center gap-1 flex-shrink-0">
            {isAdmin && onAdminEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAdminEdit();
                }}
                className="yr-focus-ring inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-muted hover:text-brand hover:bg-[var(--yr-panel-muted)] transition-colors"
                aria-label="Admin edit"
                title={`Edit ${item.type} (Admin)`}
              >
                <EditIcon size={14} />
              </button>
            )}
            {onToggleFavorite && (
              <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
            )}
          </div>
        </div>

        <div className="p-5 flex-1 flex flex-col">
          <>
            <div
              className="mb-2 flex flex-col items-start gap-1"
              style={{ paddingRight: iconClusterClearance }}
            >
              {fellowshipCycleStatus && (
                <span
                  className={`whitespace-nowrap rounded-card px-1.5 py-0.5 text-xs font-semibold ${fellowshipCycleStatus.className}`}
                >
                  {fellowshipCycleStatus.label}
                </span>
              )}
              {subtitle && (
                <span className={`text-sm font-semibold leading-snug ${subtitleColor}`}>
                  {subtitle}
                </span>
              )}
            </div>

            <h3 className="mb-2 text-base font-semibold leading-tight text-ink">
              <button
                type="button"
                onClick={handleClick}
                className="yr-focus-ring relative z-[1] -my-3 min-h-11 py-3 text-left hover:text-brand focus-visible:rounded-control"
                aria-label={`View details for ${item.data.title}`}
              >
                <span className="line-clamp-2">{item.data.title}</span>
              </button>
            </h3>

            {getItemCardSummary(item) && !isCompact && (
              <p className={`text-sm text-muted mb-2 leading-snug ${DESCRIPTION_CLAMP_CLASS}`}>
                {getItemCardSummary(item)}
              </p>
            )}

            {fellowshipFacts.length > 0 && !isCompact && (
              <ul className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium leading-snug text-ink-soft">
                {fellowshipFacts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
            )}

            {fellowshipNextStep && !isCompact && (
              <p className="mb-2 line-clamp-2 text-xs leading-snug text-muted">
                <span className="font-semibold text-ink-soft">Next:</span> {fellowshipNextStep}
              </p>
            )}

            <div className="flex-1" />

            <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
              {tags.length > 0 ? (
                <div className="flex min-w-0 flex-wrap gap-1">
                  {tags.slice(0, isCompact ? tags.length : FELLOWSHIP_TAG_CAP).map((tag) => (
                    <span
                      key={tag.label}
                      className={`${tag.bg} ${tag.text} text-xs px-1.5 py-0.5 rounded-card`}
                    >
                      {tag.label}
                    </span>
                  ))}
                  {!isCompact && tags.length > FELLOWSHIP_TAG_CAP && (
                    <span className="self-center text-xs text-muted">
                      +{tags.length - FELLOWSHIP_TAG_CAP}
                    </span>
                  )}
                </div>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={handleClick}
                className="yr-focus-ring -my-3 inline-flex min-h-11 flex-shrink-0 items-center gap-1 rounded-control text-sm font-semibold text-brand transition-colors after:absolute after:inset-0 after:content-[''] hover:text-brand-navy [&:not(:disabled):active]:transform-none [&:not(:disabled):active]:filter-none"
              >
                View details
                <ArrowRightIcon />
              </button>
            </div>
          </>
        </div>
      </div>
    );
  },
);

BrowseCard.displayName = 'BrowseCard';

export default BrowseCard;
