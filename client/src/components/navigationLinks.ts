export interface PrimaryNavLink {
  key: 'research' | 'programs' | 'account';
  label: string;
  to: string;
}

export const primaryNavLinks: PrimaryNavLink[] = [
  { key: 'research', label: 'Yale Labs', to: '/research' },
  { key: 'programs', label: 'Programs & Fellowships', to: '/programs' },
  { key: 'account', label: 'Dashboard', to: '/account' },
];

export const isPrimaryNavLinkActive = (pathname: string, link: PrimaryNavLink): boolean => {
  if (link.key === 'research') {
    return pathname === '/research' || pathname.startsWith('/research/');
  }
  if (link.key === 'programs') {
    return pathname === '/programs';
  }
  return pathname === link.to;
};
