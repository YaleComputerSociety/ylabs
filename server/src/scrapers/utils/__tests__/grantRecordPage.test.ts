import { describe, expect, it } from 'vitest';
import { grantAwardRecordKey, leadGrantAwardRecordKeys } from '../grantRecordPage';

describe('grantAwardRecordKey', () => {
  it.each([
    ['https://reporter.nih.gov/project-details/90000001', 'nih-reporter:90000001'],
    ['https://reporter.nih.gov/search/abc123/project-details/90000001', 'nih-reporter:90000001'],
    ['https://www.nsf.gov/awardsearch/showAward?AWD_ID=9000001', 'nsf:9000001'],
    ['https://www.nsf.gov/awardsearch/show-award?AWD_ID=9000001', 'nsf:9000001'],
    ['https://awardsearch.neh.gov/AwardDetail.aspx?gn=rz-900001-25', 'neh:RZ-900001-25'],
    ['https://www.osti.gov/biblio/9000001', 'osti:9000001'],
  ])('reads the award an award record page is for: %s', (url, key) => {
    expect(grantAwardRecordKey(url)).toBe(key);
  });

  it.each([
    'https://reporter.nih.gov/',
    'https://reporter.nih.gov/search/abc123/projects',
    'https://www.nsf.gov/awardsearch/',
    'https://pamspublic.science.energy.gov/WebPAMSExternal/Interface/Awards/AwardSearchExternal.aspx',
    'https://reporter-nih.example.org/project-details/90000001',
    'not a url',
  ])('reads no award from a page that is not one award record: %s', (url) => {
    expect(grantAwardRecordKey(url)).toBeNull();
  });
});

describe('leadGrantAwardRecordKeys', () => {
  const grant = (url: string, role?: string) => ({
    id: 'R01XX000001',
    url,
    ...(role ? { role } : {}),
  });

  it('keeps only awards credited to the lead as pi or copi', () => {
    expect([
      ...leadGrantAwardRecordKeys([
        grant('https://reporter.nih.gov/project-details/90000001', 'pi'),
        grant('https://reporter.nih.gov/project-details/90000002', 'copi'),
        grant('https://reporter.nih.gov/project-details/90000003'),
        grant('https://reporter.nih.gov/project-details/90000004', 'investigator'),
      ]),
    ]).toEqual(['nih-reporter:90000001', 'nih-reporter:90000002']);
  });

  it('has no keys for a row without recentGrants', () => {
    expect(leadGrantAwardRecordKeys(undefined).size).toBe(0);
    expect(leadGrantAwardRecordKeys([]).size).toBe(0);
  });
});
