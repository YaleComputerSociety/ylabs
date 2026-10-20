export const linkedSectionElement = (hash: string): HTMLElement | null => {
  const encodedId = hash.replace(/^#/, '');
  if (!encodedId) return null;
  try {
    return document.getElementById(decodeURIComponent(encodedId));
  } catch {
    return null;
  }
};
