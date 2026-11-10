export const PRIVACY_INLINE_LINK_CLASS =
  'yr-link yr-focus-ring -my-1.5 inline-block rounded-control py-1.5';

const RemovalRequestEmailLink = ({ email }: { email: string }) => (
  <a href={`mailto:${email}`} className={PRIVACY_INLINE_LINK_CLASS}>
    {email}
  </a>
);

export default RemovalRequestEmailLink;
