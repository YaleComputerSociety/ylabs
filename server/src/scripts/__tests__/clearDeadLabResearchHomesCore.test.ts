import { describe, expect, it } from 'vitest';
import {
  classifyLabHome,
  isCredibleIndex,
  labSegment,
  MINIMUM_CREDIBLE_INDEX_SIZE,
  parseIndexSegments,
} from '../clearDeadLabResearchHomesCore';

const index = (...segments: string[]) => new Set(segments);

describe('labSegment', () => {
  it('reads the segment and normalises the underscore form two rows store', () => {
    expect(labSegment('https://medicine.yale.edu/lab/iwasaki/')).toBe('iwasaki');
    expect(labSegment('https://medicine.yale.edu/lab/colon_ramos/')).toBe('colon-ramos');
    expect(labSegment('https://medicine.yale.edu/lab/pomahac/research/')).toBe('pomahac');
  });

  it('ignores urls that are not a YSM lab home', () => {
    expect(labSegment('https://mccormicklab.org/')).toBe('');
    expect(labSegment('https://medicine.yale.edu/profile/someone/')).toBe('');
    expect(labSegment(undefined)).toBe('');
  });
});

describe('classifyLabHome', () => {
  it('leaves an indexed lab alone without probing it', () => {
    expect(
      classifyLabHome(
        { websiteUrl: 'https://medicine.yale.edu/lab/iwasaki/' },
        index('iwasaki'),
        undefined,
      ),
    ).toBe('in-index');
  });

  it('clears a dead url that the index does not list', () => {
    expect(
      classifyLabHome(
        { websiteUrl: 'https://medicine.yale.edu/lab/mccormick/' },
        index('iwasaki'),
        404,
      ),
    ).toBe('clear');
  });

  it('clears when the probe could not complete, since an unreachable home is not a way in', () => {
    expect(
      classifyLabHome(
        { websiteUrl: 'https://medicine.yale.edu/lab/gone/' },
        index('iwasaki'),
        undefined,
      ),
    ).toBe('clear');
  });

  it('NEVER clears a live url, even when the index omits it', () => {
    // Two sampled rows are live School of Public Health labs on the medicine host
    // and absent from the YSM index. Index absence is not delisting evidence.
    expect(
      classifyLabHome(
        { websiteUrl: 'https://medicine.yale.edu/lab/khoshnood/' },
        index('iwasaki'),
        200,
      ),
    ).toBe('live-not-in-index');
  });

  it('ignores a non-YSM url entirely', () => {
    expect(
      classifyLabHome({ websiteUrl: 'https://mccormicklab.org/' }, index('iwasaki'), 404),
    ).toBe('not-a-ysm-lab-url');
  });

  it('treats the underscore form as indexed when the hyphen form is listed', () => {
    expect(
      classifyLabHome(
        { websiteUrl: 'https://medicine.yale.edu/lab/jun_liu/' },
        index('jun-liu'),
        404,
      ),
    ).toBe('in-index');
  });
});

describe('parseIndexSegments', () => {
  it('extracts lab segments from index markup', () => {
    const html = `
      <a href="https://medicine.yale.edu/lab/3d-tumor-lab/">3D Tumor Lab</a>
      <a href="https://medicine.yale.edu/lab/melnick/">ACCELERATE Lab</a>
      <a href="/lab/colon-ramos/">Colon-Ramos Lab</a>
      <a href="https://medicine.yale.edu/profile/someone/">not a lab</a>`;
    const segments = parseIndexSegments(html);
    expect(segments.has('3d-tumor-lab')).toBe(true);
    expect(segments.has('melnick')).toBe(true);
    expect(segments.has('colon-ramos')).toBe(true);
    expect(segments.has('someone')).toBe(false);
  });
});

describe('isCredibleIndex', () => {
  it('rejects a fragment, so an unreachable or truncated index cannot condemn live labs', () => {
    expect(isCredibleIndex(new Set())).toBe(false);
    expect(isCredibleIndex(new Set(['iwasaki', 'pomahac']))).toBe(false);
  });

  it('accepts an index at or above the floor', () => {
    const many = new Set(Array.from({ length: MINIMUM_CREDIBLE_INDEX_SIZE }, (_, i) => `lab-${i}`));
    expect(isCredibleIndex(many)).toBe(true);
  });
});
