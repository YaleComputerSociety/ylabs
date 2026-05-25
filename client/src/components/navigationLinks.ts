export interface PrimaryNavLink {
  key: 'research' | 'pathways' | 'programs' | 'account';
  label: string;
  to: string;
}

export const primaryNavLinks: PrimaryNavLink[] = [
  { key: 'research', label: 'Research', to: '/research' },
  { key: 'pathways', label: 'Pathways', to: '/pathways' },
  { key: 'programs', label: 'Programs', to: '/programs' },
  { key: 'account', label: 'Dashboard', to: '/account' },
];

export const isPrimaryNavLinkActive = (pathname: string, link: PrimaryNavLink): boolean => {
  if (link.key === 'research') {
    return pathname === '/research' || pathname.startsWith('/research/');
  }
  if (link.key === 'programs') {
    return pathname === '/programs' || pathname === '/fellowships';
  }
  return pathname === link.to;
};
