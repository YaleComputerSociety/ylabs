export function isFacultyTitle(title: string): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  const facultyKeywords = [
    'professor',
    'lecturer',
    'instructor',
    'research scientist',
    'research fellow',
    'senior lector',
    'clinical',
  ];
  return facultyKeywords.some((kw) => lower.includes(kw));
}
