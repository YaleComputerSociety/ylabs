import { Link } from 'react-router-dom';
import RemovalRequestEmailLink, { PRIVACY_INLINE_LINK_CLASS } from './RemovalRequestEmailLink';

const DirectoryRemovalRequestSentence = ({ className }: { className?: string }) => (
  <p className={className}>
    If y/labs lists you and you would like to be removed, sign in and use Remove me on{' '}
    <Link to="/dashboard" className={PRIVACY_INLINE_LINK_CLASS}>
      your dashboard
    </Link>
    , or email <RemovalRequestEmailLink /> from the address Yale publishes for you.
  </p>
);

export default DirectoryRemovalRequestSentence;
