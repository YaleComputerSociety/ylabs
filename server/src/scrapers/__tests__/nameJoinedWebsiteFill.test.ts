import { describe, expect, it } from 'vitest';
import { nameJoinedWebsiteFillIsWitnessed } from '../nameJoinedWebsiteFill';
import {
  isInadmissiblePersonWebsiteUrl,
  isStagingSiteUrl,
} from '../../utils/researchHomeWebsiteUrl';
import { withoutStagingSiteLabUrl } from '../sources/departmentRosterScraper';

describe('a name-joined website fill needs a witness (#6432)', () => {
  it('accepts a site carrying the surname or one a first-hand profile lane states', () => {
    const base = { personName: 'Alex Quillsby', contributingSources: ['dept-faculty-roster'] };
    expect(
      nameJoinedWebsiteFillIsWitnessed({ ...base, url: 'https://quillsbylab.example.org/' }),
    ).toBe(true);
    expect(
      nameJoinedWebsiteFillIsWitnessed({ ...base, url: 'https://example.org/people/quillsby' }),
    ).toBe(true);
    expect(nameJoinedWebsiteFillIsWitnessed({ ...base, url: 'https://lab.example.org/' })).toBe(
      false,
    );
    expect(
      nameJoinedWebsiteFillIsWitnessed({
        ...base,
        url: 'https://lab.example.org/',
        contributingSources: ['dept-faculty-roster', 'official-profile-pi-backfill'],
      }),
    ).toBe(true);
  });

  it('needs the surname as a whole host label or path segment, not inside another word', () => {
    const lee = { personName: 'Alex Lee', contributingSources: ['dept-faculty-roster'] };
    expect(
      nameJoinedWebsiteFillIsWitnessed({ ...lee, url: 'https://sleep-lab.example.org/' }),
    ).toBe(false);
    expect(
      nameJoinedWebsiteFillIsWitnessed({ ...lee, url: 'https://example.org/colleen-group/' }),
    ).toBe(false);
    expect(nameJoinedWebsiteFillIsWitnessed({ ...lee, url: 'https://leelab.example.org/' })).toBe(
      true,
    );
    expect(nameJoinedWebsiteFillIsWitnessed({ ...lee, url: 'https://example.org/lee-group' })).toBe(
      true,
    );
  });

  it('never treats a surname of under three letters, or a missing one, as a witness', () => {
    expect(
      nameJoinedWebsiteFillIsWitnessed({
        url: 'https://wu-lab.example.org/',
        personName: 'Alex Wu',
        contributingSources: [],
      }),
    ).toBe(false);
    expect(
      nameJoinedWebsiteFillIsWitnessed({
        url: 'https://x.example.org/',
        personName: '',
        contributingSources: [],
      }),
    ).toBe(false);
  });
});

describe('a staging or hosting-provider site (#6432)', () => {
  it('refuses a provider environment host and a staging-labelled host', () => {
    for (const url of [
      'https://dev-example-lab.pantheonsite.io/',
      'https://live-example.pantheonsite.io/people',
      'https://examplelab.wpengine.com/',
      'https://staging.examplelab.org/',
      'https://dev2.examplelab.org/',
    ]) {
      expect(isStagingSiteUrl(url)).toBe(true);
      expect(isInadmissiblePersonWebsiteUrl(url)).toBe(true);
    }
  });

  it('keeps a public site whose host only starts with a staging-like word', () => {
    for (const url of [
      'https://devlab.example.org/',
      'https://testa.org/',
      'https://examplelab.org/staging/',
      'https://pantheonsite.io.example.org/',
    ]) {
      expect(isStagingSiteUrl(url)).toBe(false);
    }
  });

  it('drops a staging lab link from a roster entry at ingest and keeps any other link', () => {
    expect(
      withoutStagingSiteLabUrl({ name: 'Alex Quillsby', labUrl: 'https://dev-x.pantheonsite.io/' }),
    ).toEqual({ name: 'Alex Quillsby' });
    expect(
      withoutStagingSiteLabUrl({ name: 'Alex Quillsby', labUrl: 'https://x.example.org/' }),
    ).toEqual({
      name: 'Alex Quillsby',
      labUrl: 'https://x.example.org/',
    });
  });
});
