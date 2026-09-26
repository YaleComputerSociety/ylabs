/**
 * The y/labs wordmark. The slash is a separate element so it can be scaled
 * taller than the lowercase letters, matching the y/cs family it derives from.
 */
interface WordmarkProps {
  readonly className?: string;
}

const Wordmark = ({ className }: WordmarkProps) => (
  <span className={className ? `yr-wordmark ${className}` : 'yr-wordmark'}>
    y<span className="yr-wordmark-slash">/</span>labs
  </span>
);

export default Wordmark;
