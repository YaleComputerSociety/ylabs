import { describe, expect, it } from 'vitest';
import {
  isCardLosingDescriptionRefresh,
  withServedCardForBody,
  type DescriptionCardJudge,
} from '../descriptionCardRefreshGuard';

const OLD_BODY = 'The Example Lab studies how cells sense mechanical force.';
const NEW_BODY =
  'Studies how cells sense and respond to mechanical force during tissue repair, combining live imaging of wound healing with models of fibrosis.';
const CACHED_CARD = 'Studies how cells sense mechanical force in tissue repair.';
const subject = { entityType: 'researchEntity' as const, entityKey: 'example-lab' };

const cardCompleteWhen: DescriptionCardJudge = async (_subject, pair) =>
  pair.fullDescription === OLD_BODY || pair.shortDescription === CACHED_CARD;

describe('a written body is judged with the card materialization serves beside it (#5961)', () => {
  it('reads the bare body as losing the card, which is the refusal the writer kept hitting', async () => {
    expect(
      await isCardLosingDescriptionRefresh({
        subject,
        existing: { fullDescription: OLD_BODY },
        incoming: { fullDescription: NEW_BODY },
        judge: cardCompleteWhen,
      }),
    ).toBe(true);
  });

  it('takes the refresh when the cached card for the new body serves', async () => {
    const judge = withServedCardForBody(cardCompleteWhen, async (body) =>
      body === NEW_BODY ? CACHED_CARD : '',
    );
    expect(
      await isCardLosingDescriptionRefresh({
        subject,
        existing: { fullDescription: OLD_BODY },
        incoming: { fullDescription: NEW_BODY },
        judge,
      }),
    ).toBe(false);
  });

  it('still refuses the refresh when the new body has no cached card', async () => {
    const judge = withServedCardForBody(cardCompleteWhen, async () => '');
    expect(
      await isCardLosingDescriptionRefresh({
        subject,
        existing: { fullDescription: OLD_BODY },
        incoming: { fullDescription: NEW_BODY },
        judge,
      }),
    ).toBe(true);
  });

  it('leaves a pair that already carries a card to the judge as it is', async () => {
    const seen: unknown[] = [];
    const judge = withServedCardForBody(
      async (_subject, pair) => {
        seen.push(pair.shortDescription);
        return true;
      },
      async () => CACHED_CARD,
    );
    await judge(subject, { fullDescription: NEW_BODY, shortDescription: 'An incoming card.' }, {});
    expect(seen).toEqual(['An incoming card.']);
  });
});
