/**
 * Favorite/unfavorite toggle button for listings and fellowships.
 */
import React from 'react';
import { BookmarkIcon } from './icons';

export const watchControlVerb = (isWatched: boolean): string =>
  isWatched ? 'Stop watching' : 'Watch';

export const watchControlLabel = (title: string, isWatched: boolean): string =>
  `${watchControlVerb(isWatched)} ${title}`;

interface FavoriteButtonProps {
  isFavorite: boolean;
  onToggle: (e: React.MouseEvent) => void;
  size?: number;
  ariaLabel?: string;
  title?: string;
  className?: string;
  iconClassName?: string;
  children?: React.ReactNode;
}

const FavoriteButton = React.memo(
  ({
    isFavorite,
    onToggle,
    size = 16,
    ariaLabel,
    title,
    className,
    iconClassName,
    children,
  }: FavoriteButtonProps) => {
    const stateClassName = isFavorite ? 'text-brand' : 'text-muted hover:text-brand';
    const layoutClassName =
      className ??
      'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control';
    const buttonClassName = `yr-focus-ring ${layoutClassName} transition-colors ${stateClassName}`;

    return (
      <button
        type="button"
        onClick={onToggle}
        className={buttonClassName}
        aria-label={ariaLabel || watchControlVerb(isFavorite)}
        aria-pressed={isFavorite}
        title={title}
      >
        <BookmarkIcon className={iconClassName} size={size} filled={isFavorite} />
        {children}
      </button>
    );
  },
);

FavoriteButton.displayName = 'FavoriteButton';

export default FavoriteButton;
