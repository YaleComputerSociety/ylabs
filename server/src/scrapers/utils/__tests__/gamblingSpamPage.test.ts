import { describe, expect, it } from 'vitest';
import { isGamblingSpamPage } from '../gamblingSpamPage';
import { nonContentResearchPageReason } from '../nonContentResearchPage';
import { researchPageTextEntries } from '../researchPageText';

const TAKEN_OVER_DOMAIN_PAGE =
  'CONTOH88 | Situs Resmi Slot Gacor Hari Ini. Link alternatif resmi untuk member baru, ' +
  'Minimal Deposit Rp 20.000, Minimal Withdraw Rp 50.000, layanan 24 jam nonstop ya bosku.';

const GAMBLING_RESEARCH =
  'Our lab studies how slot machines and online casino design shape betting behavior, ' +
  'and how gambling disorder responds to treatment in adolescents and adults.';

const ONE_PHRASE_RESEARCH =
  'We interview young adults in Jakarta about attitudes toward judi and family finances.';

describe('isGamblingSpamPage (#6532)', () => {
  it('recognizes a gambling page that a taken-over domain serves', () => {
    expect(isGamblingSpamPage(TAKEN_OVER_DOMAIN_PAGE)).toBe(true);
  });

  it('keeps research about gambling written in English', () => {
    expect(isGamblingSpamPage(GAMBLING_RESEARCH)).toBe(false);
  });

  it('keeps a research page that uses one gambling-site word', () => {
    expect(isGamblingSpamPage(ONE_PHRASE_RESEARCH)).toBe(false);
  });

  it('keeps a person page for someone named Judi', () => {
    expect(
      isGamblingSpamPage(
        'Judi Rivera studies slot online scheduling for clinics and directs the lab.',
      ),
    ).toBe(false);
  });

  it('does not read a hyphenated class name as a phrase', () => {
    expect(isGamblingSpamPage('<div class="slot-online judi-card">Lab news</div>')).toBe(false);
  });
});

describe('a gambling page is never research page text (#6532)', () => {
  it('names the gambling-spam reason for the page', () => {
    expect(
      nonContentResearchPageReason({
        url: 'https://lapsed-lab-site.example/',
        text: TAKEN_OVER_DOMAIN_PAGE,
      }),
    ).toBe('gambling-spam');
  });

  it("drops the stored gambling page on read and keeps the row's research page beside it", () => {
    const research = {
      url: 'https://lab.yale.edu/research',
      text: 'We study how neurons find their signaling partners during development.',
    };
    const stored = [
      { url: 'https://lapsed-lab-site.example/', text: TAKEN_OVER_DOMAIN_PAGE },
      research,
    ];

    expect(researchPageTextEntries(stored)).toEqual([research]);
  });
});
