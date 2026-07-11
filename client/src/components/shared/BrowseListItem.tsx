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
  getResearchGroupDisplayName,
  getResearchGroupKindLabel,
  getResearchEntityBestNextStep,
  getResearchEntityPathwaySummary,
  getFellowshipJourneySummary,
  getResearchGroupStatus,
  getDaysUntilDeadline,
  getOrderedDeptAbbrs,
  DEPT_CAP,
  TAG_CAP,
  DESCRIPTION_CLAMP_CLASS,
} from '../../types/browsable';
import StatusBadge from './StatusBadge';
import FavoriteButton from './FavoriteButton';
import HasPrerequisitesIcon from './HasPrerequisitesIcon';
import UrgentBadge from './UrgentBadge';
import ArchivedBadge from './ArchivedBadge';
import ConfigContext from '../../contexts/ConfigContext';
import UserContext from '../../contexts/UserContext';
import { useViewTracking } from '../../hooks/useViewTracking';
import { getDepartmentAbbreviation, getDepartmentCanonicalLabel } from '../../utils/departmentNames';
import { getFellowshipCycleStatus } from '../../utils/fellowshipCycle';

interface BrowseListItemProps {
  item: BrowsableItem;
  isFavorite: boolean;
  onToggleFavorite?: (e: React.MouseEvent) => void;
  onOpenModal: () => void;
  onAdminEdit?: () => void;
  isCompact?: boolean;
}

const BrowseListItem = React.memo(({ item, isFavorite, onToggleFavorite, onOpenModal, onAdminEdit, isCompact }: BrowseListItemProps) => {
  const { departments, getColorForResearchArea } = useContext(ConfigContext);
  const { user } = useContext(UserContext);
  const isAdmin = user?.userType === 'admin';
  const open = isItemOpen(item);
  const tags = useMemo(() => getItemTags(item, getColorForResearchArea), [item, getColorForResearchArea]);
  const trackView = useViewTracking(item.type, getItemId(item));

  const hasPrerequisites = item.type === 'listing' &&
    !!item.data.applicantDescription && item.data.applicantDescription.trim() !== '';

  const daysUntil = getDaysUntilDeadline(item);
  const urgentBadge = item.type === 'fellowship' && daysUntil !== null && daysUntil > 0 && daysUntil <= 14;

  const isListing = item.type === 'listing';
  const isResearchGroup = item.type === 'researchGroup';
  const professorName = isListing
    ? `${item.data.ownerFirstName} ${item.data.ownerLastName}`
    : null;
  const isArchived = isListing && item.data.archived;

  const deptInfo = useMemo(() => {
    if (!isListing) return null;
    return getOrderedDeptAbbrs(
      item.data.departments,
      item.data.ownerPrimaryDepartment,
      DEPT_CAP,
      departments,
    );
  }, [item, isListing, departments]);

  const deptLabel = deptInfo && deptInfo.abbrs.length > 0
    ? deptInfo.abbrs.join(' | ') + (deptInfo.truncated > 0 ? ` +${deptInfo.truncated}` : '')
    : null;

  const listingDept = isListing && item.data.departments && item.data.departments.length > 0
    ? getDepartmentAbbreviation(getDepartmentCanonicalLabel(item.data.departments[0], departments))
    : null;

  const subtitle = getItemSubtitle(item);
  const subtitleColor = getItemSubtitleColor(item);
  const researchStatus = getResearchGroupStatus(item);
  const researchPathwaySummary = isResearchGroup
    ? getResearchEntityPathwaySummary(item.data)
    : null;
  const researchBestNextStep = isResearchGroup
    ? getResearchEntityBestNextStep(item.data)
    : null;
  const fellowshipCycleStatus = item.type === 'fellowship'
    ? getFellowshipCycleStatus(item.data)
    : null;
  const fellowshipJourneySummary = item.type === 'fellowship'
    ? getFellowshipJourneySummary(item.data)
    : null;

  const isAudited = isAdmin && item.type !== 'researchGroup' && item.data.audited;

  const handleClick = () => {
    trackView();
    onOpenModal();
  };

  return (
    <div
      className={`group bg-[var(--yr-panel)] rounded-md border ${isAudited ? 'border-green-400 ring-1 ring-green-200' : 'border-[var(--yr-line)]'} hover:border-blue-400 hover:shadow-sm transition-all duration-200 cursor-pointer ${isArchived ? 'opacity-75' : ''}`}
      onClick={item.type === 'fellowship' ? undefined : handleClick}
    >
      <div className="p-4 grid grid-cols-12 gap-4 items-start">
        <div className={`col-span-12 ${isCompact ? 'md:col-span-10' : 'md:col-span-4'}`}>
          <div className="flex items-center gap-2 mb-0.5">
            {deptLabel && (
              <span className="text-xs font-semibold text-blue-700 truncate">
                {deptLabel}
              </span>
            )}
            {isArchived && <ArchivedBadge />}
          </div>
          {urgentBadge && daysUntil !== null && (
            <UrgentBadge daysUntil={daysUntil} variant="inline" />
          )}
          {isResearchGroup ? (
            <>
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <span className="text-xs font-semibold text-blue-700 truncate">
                  {getResearchGroupKindLabel(item.data.kind)}
                </span>
                {item.data.accessSummary?.hasActivePostedOpportunity && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
                    Active opportunity
                  </span>
                )}
              </div>
              <h3 className="text-sm font-semibold text-gray-900 truncate">
                {getResearchGroupDisplayName(item.data)}
              </h3>
              <p className="text-xs text-gray-500 truncate">
                {subtitle}
              </p>
            </>
          ) : isListing ? (
            <>
              <h3 className="text-sm font-semibold text-gray-900 truncate">
                {professorName}
              </h3>
              <p className="text-xs text-gray-500 truncate">
                {item.data.title}{listingDept ? ` · ${listingDept}` : ''}
              </p>
            </>
          ) : (
            <>
              <h3 className="text-sm font-semibold text-gray-900">
                <button
                  type="button"
                  onClick={handleClick}
                  className="block max-w-full truncate text-left hover:text-blue-700 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  aria-label={`View details for ${item.data.title}`}
                >
                  {item.data.title}
                </button>
              </h3>
              <p className={`text-xs ${subtitleColor} truncate`}>
                {subtitle}
              </p>
            </>
          )}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {tags.slice(0, isCompact ? tags.length : TAG_CAP).map((tag) => (
                <span
                  key={tag.label}
                  className={`${tag.bg} ${tag.text} text-xs px-1.5 py-0.5 rounded`}
                >
                  {tag.label}
                </span>
              ))}
              {!isCompact && tags.length > TAG_CAP && (
                <span className="text-xs text-gray-400">+{tags.length - TAG_CAP}</span>
              )}
            </div>
          )}
        </div>

        {!isCompact && (
          <div className="col-span-6 hidden md:block">
            <p className={`text-sm text-gray-600 ${DESCRIPTION_CLAMP_CLASS}`}>
              {item.type === 'listing'
                ? item.data.description
                : item.type === 'researchGroup'
                  ? researchPathwaySummary || researchBestNextStep || item.data.description
                  : item.data.bestNextStep || fellowshipJourneySummary || item.data.summary || item.data.description}
            </p>
          </div>
        )}

        <div className="col-span-12 md:col-span-2 flex md:flex-col items-center md:items-end gap-2 flex-shrink-0">
          <div className="flex items-center gap-1">
            {hasPrerequisites && <HasPrerequisitesIcon />}
            {isResearchGroup && researchStatus ? (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${researchStatus.className}`}>
                {researchStatus.label}
              </span>
            ) : fellowshipCycleStatus ? (
              <span
                className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${fellowshipCycleStatus.className}`}
              >
                {fellowshipCycleStatus.label}
              </span>
            ) : (
              <StatusBadge isOpen={open} />
            )}
          </div>
          <div className="flex items-center gap-1">
            {isAdmin && onAdminEdit && (
              <button
                onClick={(e) => { e.stopPropagation(); onAdminEdit(); }}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-gray-500 hover:text-blue-600 hover:bg-[var(--yr-panel-muted)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                title="Edit listing (Admin)"
                aria-label="Admin edit"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            )}
            {onToggleFavorite && item.type !== 'researchGroup' && (
              <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

BrowseListItem.displayName = 'BrowseListItem';

export default BrowseListItem;
