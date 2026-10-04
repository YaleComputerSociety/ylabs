const RECENT_HONOR_YEARS = 5;

export const formatLeadHonors = (
  group: { leadHonors?: unknown },
  currentYear: number = new Date().getFullYear(),
): { recent: string | null; other: string | null } => {
  const honors = (Array.isArray(group.leadHonors) ? group.leadHonors : []).filter(
    (honor: any) => typeof honor?.label === 'string' && honor.label.trim(),
  );
  const isRecent = (honor: any) =>
    typeof honor.year === 'number' && honor.year >= currentYear - RECENT_HONOR_YEARS;
  const recent = honors
    .filter(isRecent)
    .map((honor: any) => `${honor.label.trim()} (${honor.year})`);
  const other = honors
    .filter((honor: any) => !isRecent(honor))
    .map((honor: any) => honor.label.trim());
  return {
    recent: recent.length ? `Recent fellowships & awards: ${recent.join(', ')}` : null,
    other: other.length ? `Fellowships & honors: ${other.join(', ')}` : null,
  };
};
