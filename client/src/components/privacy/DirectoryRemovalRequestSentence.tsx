import { Link } from 'react-router-dom';
import { DIRECTORY_REMOVAL_REQUEST_EMAIL } from '../../utils/privacyNotice';

const INLINE_LINK_CLASS = 'yr-link yr-focus-ring -my-1.5 inline-block rounded-control py-1.5';

const DirectoryRemovalRequestSentence = ({
  email = DIRECTORY_REMOVAL_REQUEST_EMAIL,
  className,
}: {
  email?: string;
  className?: string;
}) => (
  <p className={className}>
    If y/labs lists you and you would like to be removed, sign in and use Remove me on{' '}
    <Link to="/dashboard" className={INLINE_LINK_CLASS}>
      your dashboard
    </Link>
    {email ? (
      <>
        , or email{' '}
        <a href={`mailto:${email}`} className={INLINE_LINK_CLASS}>
          {email}
        </a>{' '}
        from the address Yale publishes for you.
      </>
    ) : (
      '.'
    )}
  </p>
);

export default DirectoryRemovalRequestSentence;
