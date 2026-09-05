import { useEffect } from 'react';

const DEFAULT_TITLE = 'y/labs';

export const formatDocumentTitle = (pageTitle?: string): string => {
  const trimmed = (pageTitle || '').trim();
  if (!trimmed) {
    return DEFAULT_TITLE;
  }
  if (trimmed.toLowerCase() === DEFAULT_TITLE.toLowerCase()) {
    return DEFAULT_TITLE;
  }
  if (trimmed.toLowerCase().endsWith(`| ${DEFAULT_TITLE}`.toLowerCase())) {
    return trimmed;
  }
  return `${trimmed} | ${DEFAULT_TITLE}`;
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
