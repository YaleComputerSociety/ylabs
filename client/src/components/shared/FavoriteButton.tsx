/**
 * Favorite/unfavorite toggle button for listings and fellowships.
 */
import React from 'react';

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

const FavoriteButton = React.memo(({
  isFavorite,
  onToggle,
  size = 16,
  ariaLabel,
  title,
  className,
  iconClassName,
  children,
}: FavoriteButtonProps) => {
  const stateClassName = isFavorite ? 'text-blue-600' : 'text-gray-400 hover:text-blue-600';
  const buttonClassName = className
    ? `${className} ${stateClassName}`
    : `inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${stateClassName}`;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={buttonClassName}
      aria-label={ariaLabel || (isFavorite ? 'Remove from favorites' : 'Add to favorites')}
      aria-pressed={isFavorite}
      title={title}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={isFavorite ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
        className={iconClassName}
      >
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
      {children}
    </button>
  );
});

FavoriteButton.displayName = 'FavoriteButton';

export default FavoriteButton;
