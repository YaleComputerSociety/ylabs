export interface PrimaryNavLink {
  key: 'research' | 'pathways' | 'fellowships' | 'account';
  label: string;
  to: string;
}

export const primaryNavLinks: PrimaryNavLink[] = [
  { key: 'research', label: 'Research', to: '/research' },
  { key: 'pathways', label: 'Pathways', to: '/pathways' },
  { key: 'fellowships', label: 'Find Fellowships', to: '/fellowships' },
  { key: 'account', label: 'Dashboard', to: '/account' },
];

export const isPrimaryNavLinkActive = (pathname: string, link: PrimaryNavLink): boolean => {
  if (link.key === 'research') {
    return pathname === '/research' || pathname.startsWith('/research/');
  }
  return pathname === link.to;
};
