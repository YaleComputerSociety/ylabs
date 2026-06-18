import { useEffect } from 'react';

const DEFAULT_TITLE = 'Yale Research';

export const formatDocumentTitle = (pageTitle?: string): string => {
  const trimmed = (pageTitle || '').trim();
  return trimmed ? `${trimmed} | ${DEFAULT_TITLE}` : DEFAULT_TITLE;
};

const useDocumentTitle = (pageTitle?: string) => {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = formatDocumentTitle(pageTitle);

    return () => {
      document.title = previousTitle;
    };
  }, [pageTitle]);
};

export default useDocumentTitle;
