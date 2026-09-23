import { describe, it, expect } from 'vitest';
import { isPhilanthropicFundAppealText } from '../descriptionHygiene';
import { fullDescriptionQuality } from '../researchEntityDescriptionQuality';
import {
  describesResearchHome,
  offTopicResearchHomeDemotionScore,
  selectResearchHomeDescription,
} from '../researchHomeDescriptionSelection';

const APPEAL_WITH_DONATION_OPENER =
  'Click here to donate to the Coastal Storm Relief Fund. The storm season arrives amid a warming ocean, and island communities face an above average number of severe storms this year. Shelter capacity and access to aid are both expected to tighten across the region.';

const APPEAL_FUND_NARRATIVE =
  'The storm season arrives amid a warming ocean, and island communities face an above average number of severe storms. The Coastal Storm Relief Fund and a community foundation raise funds to help local non-profit organizations meet the health and well-being needs of their communities after a disaster. The fund was created in response to two earlier hurricanes. Organizations can use funds to replace lost supplies or rebuild other vital resources.';

const CENTER_MISSION_PROSE =
  'The center generates actionable research on the causes of health and healthcare inequity, and studies how care delivery can be redesigned to narrow it. It supports a research portfolio that is rigorous, collaborative, and translatable into policy and practice.';

const FOUNDING_GIFT_PROSE =
  'The Coastal Sciences Institute, established with a generous gift from two alumni, studies how warming oceans reshape sediment chemistry along tidal coastlines. Its faculty combine field sampling with numerical models of storm surge and shoreline retreat.';

const DONATED_ARCHIVE_PROSE =
  'The Center for the Study of Diplomacy was established in 2011, shortly after a former secretary of state donated his papers to the university library. The center studies the conduct of twentieth-century diplomacy through those archives and trains historians to read them.';

describe('isPhilanthropicFundAppealText', () => {
  it('refuses an appeal whose opening sentence asks for a donation', () => {
    expect(isPhilanthropicFundAppealText(APPEAL_WITH_DONATION_OPENER)).toBe(true);
  });

  it('refuses a fund narrative that carries no donation imperative at all', () => {
    expect(isPhilanthropicFundAppealText(APPEAL_FUND_NARRATIVE)).toBe(true);
  });

  it('keeps research prose that merely records a founding gift or a donated archive', () => {
    expect(isPhilanthropicFundAppealText(FOUNDING_GIFT_PROSE)).toBe(false);
    expect(isPhilanthropicFundAppealText(DONATED_ARCHIVE_PROSE)).toBe(false);
    expect(isPhilanthropicFundAppealText(CENTER_MISSION_PROSE)).toBe(false);
  });
});

describe('a fund appeal at the description quality floor', () => {
  it('flags the appeal and leaves founding-gift prose unflagged', () => {
    expect(fullDescriptionQuality(APPEAL_FUND_NARRATIVE).flags).toContain('fundraising-appeal');
    expect(fullDescriptionQuality(APPEAL_FUND_NARRATIVE).isUseful).toBe(false);
    expect(fullDescriptionQuality(FOUNDING_GIFT_PROSE).flags).not.toContain('fundraising-appeal');
  });

  it('refuses the appeal as a research-home description candidate', () => {
    expect(describesResearchHome(APPEAL_FUND_NARRATIVE)).toBe(false);
    expect(describesResearchHome(CENTER_MISSION_PROSE)).toBe(true);
  });

  it('ranks the appeal below the mission prose it used to tie with', () => {
    expect(offTopicResearchHomeDemotionScore(APPEAL_FUND_NARRATIVE)).toBeLessThan(
      offTopicResearchHomeDemotionScore(CENTER_MISSION_PROSE),
    );
  });

  it("takes the unit's own mission prose even when the appeal is offered first", () => {
    expect(
      selectResearchHomeDescription([APPEAL_FUND_NARRATIVE, CENTER_MISSION_PROSE], {
        kind: 'organization',
      }),
    ).toBe(CENTER_MISSION_PROSE);
  });
});
