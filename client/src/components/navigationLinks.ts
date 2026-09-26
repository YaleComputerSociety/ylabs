export interface PrimaryNavLink {
  key: 'research' | 'programs' | 'dashboard';
  label: string;
  to: string;
}

export const primaryNavLinks: PrimaryNavLink[] = [
  { key: 'research', label: 'Research', to: '/research' },
  { key: 'programs', label: 'Programs & Fellowships', to: '/programs' },
  { key: 'dashboard', label: 'Dashboard', to: '/dashboard' },
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
