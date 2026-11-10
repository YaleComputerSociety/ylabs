import { Link } from 'react-router-dom';
import { DIRECTORY_REMOVAL_REQUEST_EMAIL } from '../../utils/privacyNotice';
import RemovalRequestEmailLink, { PRIVACY_INLINE_LINK_CLASS } from './RemovalRequestEmailLink';

const DirectoryRemovalRequestSentence = ({
  email = DIRECTORY_REMOVAL_REQUEST_EMAIL,
  className,
}: {
  email?: string;
  className?: string;
}) => (
  <p className={className}>
    If y/labs lists you and you would like to be removed, sign in and use Remove me on{' '}
    <Link to="/dashboard" className={PRIVACY_INLINE_LINK_CLASS}>
      your dashboard
    </Link>
    {email ? (
      <>
        , or email <RemovalRequestEmailLink email={email} /> from the address Yale publishes for
        you.
      </>
    ) : (
      '.'
    )}
  </p>
);

export default DirectoryRemovalRequestSentence;
