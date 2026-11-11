import { PRIVACY_CONTACT_EMAIL, PRIVACY_CONTACT_MAILTO } from '../../utils/privacyContact';

export const PRIVACY_INLINE_LINK_CLASS =
  'yr-link yr-focus-ring -my-1.5 inline-block rounded-control py-1.5';

const RemovalRequestEmailLink = () => (
  <a href={PRIVACY_CONTACT_MAILTO} className={PRIVACY_INLINE_LINK_CLASS}>
    {PRIVACY_CONTACT_EMAIL}
  </a>
);

export default RemovalRequestEmailLink;
