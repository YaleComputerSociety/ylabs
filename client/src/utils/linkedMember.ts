export const linkedMemberName = (search: string): string | undefined =>
  new URLSearchParams(search).get('member') || undefined;
