export function isAreaShellSlug(slug: string | undefined): boolean {
  return (slug || '').toLowerCase().startsWith('faculty-research-area-');
}

export function isFundingShellSlug(slug: string | undefined): boolean {
  const value = (slug || '').toLowerCase();
  return (
    value.startsWith('nih-pi-') ||
    value.startsWith('nsf-pi-') ||
    value.startsWith('federal-pi-') ||
    value.startsWith('doe-pi-')
  );
}

export function isLowTrustAreaShellSlug(slug: string | undefined): boolean {
  return isAreaShellSlug(slug) || isFundingShellSlug(slug);
}
