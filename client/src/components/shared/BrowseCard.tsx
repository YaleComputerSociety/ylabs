/**
 * Card view component for browsable research homes and fellowships.
 */
import React, { useContext, useMemo } from 'react';
import {
  BrowsableItem,
  getItemId,
  getItemTags,
  getItemSubtitle,
  getItemSubtitleColor,
  getResearchGroupDisplayName,
  getResearchGroupKindLabel,
  getDaysUntilDeadline,
  TAG_CAP,
  FELLOWSHIP_TAG_CAP,
  DESCRIPTION_CLAMP_CLASS,
} from '../../types/browsable';
import FavoriteButton from './FavoriteButton';
import UrgentBadge from './UrgentBadge';
import ConfigContext from '../../contexts/ConfigContext';
import UserContext from '../../contexts/UserContext';
import { useViewTracking } from '../../hooks/useViewTracking';
import { getFellowshipCycleStatus } from '../../utils/fellowshipCycle';

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
    const { getColorForResearchArea } = useContext(ConfigContext);
    const { user } = useContext(UserContext);
    const isAdmin = user?.isAdmin ?? false;
    const tags = useMemo(
      () => getItemTags(item, getColorForResearchArea),
      [item, getColorForResearchArea],
    );
    const trackView = useViewTracking(item.type, getItemId(item));

    const daysUntil = getDaysUntilDeadline(item);
    const showUrgentBanner =
      item.type === 'fellowship' && daysUntil !== null && daysUntil > 0 && daysUntil <= 14;

    const isResearchGroup = item.type === 'researchGroup';

    const subtitle = getItemSubtitle(item);
    const subtitleColor = getItemSubtitleColor(item);
    const fellowshipCycleStatus =
      item.type === 'fellowship' ? getFellowshipCycleStatus(item.data) : null;
    const fellowshipNextStep =
      item.type === 'fellowship' ? item.data.bestNextStep?.trim() || null : null;

    const isAudited = isAdmin && item.type !== 'researchGroup' && item.data.audited;

    const iconClusterCount =
      (isAdmin && onAdminEdit ? 1 : 0) +
      (onToggleFavorite && item.type !== 'researchGroup' ? 1 : 0);
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
        className={`yr-card-interactive group relative rounded-md ${isAudited ? 'border-green-400 ring-1 ring-green-200' : ''} cursor-pointer overflow-hidden h-full flex flex-col`}
        onClick={item.type === 'fellowship' ? undefined : handleClick}
      >
        {showUrgentBanner && daysUntil !== null && (
          <UrgentBadge daysUntil={daysUntil} variant="banner" />
        )}

        <div className="p-5 flex-1 flex flex-col">
          <div className="absolute top-2 right-2 flex items-center gap-1 z-10 flex-shrink-0">
            {isAdmin && onAdminEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAdminEdit();
                }}
                className="yr-focus-ring inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-gray-500 hover:text-blue-600 hover:bg-[var(--yr-panel-muted)] transition-colors"
                aria-label="Admin edit"
                title={`Edit ${item.type} (Admin)`}
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
                  aria-hidden="true"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            )}
            {onToggleFavorite && item.type !== 'researchGroup' && (
              <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
            )}
          </div>

          {isResearchGroup ? (
            <>
              <div
                className="flex items-center gap-2 mb-2 flex-wrap"
                style={{ paddingRight: iconClusterClearance }}
              >
                <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-[var(--yr-blue-soft)] text-blue-700">
                  {getResearchGroupKindLabel(item.data.kind)}
                </span>
              </div>

              <h3 className="text-base font-bold text-gray-900 leading-tight line-clamp-2">
                {getResearchGroupDisplayName(item.data)}
              </h3>

              <p className="text-sm text-gray-600 mb-1 line-clamp-1 leading-snug">{subtitle}</p>

              {item.data.shortDescription && !isCompact && (
                <p className={`text-sm text-gray-500 mb-2 leading-snug ${DESCRIPTION_CLAMP_CLASS}`}>
                  {item.data.shortDescription}
                </p>
              )}

              {tags.length > 0 && !isCompact && (
                <div className="border-t border-[var(--yr-line)] my-2" />
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
                    <span className="text-xs text-gray-600">+{tags.length - TAG_CAP}</span>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div
                className="mb-2 flex flex-col items-start gap-1"
                style={{ paddingRight: iconClusterClearance }}
              >
                {fellowshipCycleStatus && (
                  <span
                    className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold ${fellowshipCycleStatus.className}`}
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

              <h3 className="mb-2 text-base font-bold leading-tight text-gray-900">
                <button
                  type="button"
                  onClick={handleClick}
                  className="yr-focus-ring line-clamp-2 text-left hover:text-blue-700 focus-visible:rounded-sm"
                  aria-label={`View details for ${item.data.title}`}
                >
                  {item.data.title}
                </button>
              </h3>

              {item.data.summary && !isCompact && (
                <p className={`text-sm text-gray-500 mb-2 leading-snug ${DESCRIPTION_CLAMP_CLASS}`}>
                  {item.data.summary}
                </p>
              )}

              {fellowshipNextStep && !isCompact && (
                <p className="mb-2 line-clamp-2 text-xs leading-snug text-slate-600">
                  <span className="font-semibold text-slate-700">Next:</span> {fellowshipNextStep}
                </p>
              )}

              <div className="flex-1" />

              <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--yr-line)] pt-3">
                {tags.length > 0 ? (
                  <div className="flex min-w-0 flex-wrap gap-1">
                    {tags.slice(0, isCompact ? tags.length : FELLOWSHIP_TAG_CAP).map((tag) => (
                      <span
                        key={tag.label}
                        className={`${tag.bg} ${tag.text} text-xs px-1.5 py-0.5 rounded`}
                      >
                        {tag.label}
                      </span>
                    ))}
                    {!isCompact && tags.length > FELLOWSHIP_TAG_CAP && (
                      <span className="self-center text-xs text-gray-600">
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
                  className="yr-focus-ring inline-flex flex-shrink-0 items-center gap-1 rounded-sm text-sm font-semibold text-[var(--yr-blue)] transition-colors hover:text-blue-800"
                >
                  View details
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
                    aria-hidden="true"
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  },
);

BrowseCard.displayName = 'BrowseCard';

export default BrowseCard;
