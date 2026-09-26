interface ArrowRightIconProps {
  size?: number;
  className?: string;
}

/**
 * The one forward-affordance glyph. There were two: this path, and a literal
 * "→" character on the other browse card, so the same affordance rendered at two
 * weights and two sizes depending on which card you were looking at.
 */
const ArrowRightIcon = ({ size = 14, className }: ArrowRightIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

export default ArrowRightIcon;
