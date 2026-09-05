import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import useDocumentTitle, { formatDocumentTitle } from '../useDocumentTitle';

describe('formatDocumentTitle', () => {
  it('appends the site name to a page-specific segment', () => {
    expect(formatDocumentTitle('Analytics')).toBe('Analytics | y/labs');
  });

  it('returns the bare site name when no segment is provided', () => {
    expect(formatDocumentTitle()).toBe('y/labs');
    expect(formatDocumentTitle('')).toBe('y/labs');
    expect(formatDocumentTitle('   ')).toBe('y/labs');
  });

  it('does not double the site name when the segment already equals it', () => {
    expect(formatDocumentTitle('y/labs')).toBe('y/labs');
    expect(formatDocumentTitle('  y/labs  ')).toBe('y/labs');
  });

  it('does not double the site name when the segment already ends with it', () => {
    expect(formatDocumentTitle('Analytics | y/labs')).toBe('Analytics | y/labs');
  });
});

describe('useDocumentTitle', () => {
  afterEach(() => {
    document.title = '';
  });

  it('sets the document title and restores the previous title on unmount', () => {
    document.title = 'Previous';
    const { unmount } = renderHook(() => useDocumentTitle('Research'));
    expect(document.title).toBe('Research | y/labs');
    unmount();
    expect(document.title).toBe('Previous');
  });
});
