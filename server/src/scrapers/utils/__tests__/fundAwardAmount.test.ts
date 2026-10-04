import { describe, expect, it } from 'vitest';
import { fundAwardAmount, proseAwardAmount } from '../fundAwardAmount';

const fromProse = (...sections: string[]) => fundAwardAmount(undefined, sections);

describe('the award amount a fund states in its prose (#4588)', () => {
  it('keeps a range whole rather than picking one number out of it', () => {
    expect(fromProse('Grants range from $500 to $5,000 for summer research.')).toBe(
      '$500 to $5,000',
    );
    expect(fromProse('Award amounts range from $200-$2000.')).toBe('$200 to $2000');
    expect(fromProse('Awards are between $250 and 1,500 for each project.')).toBe('$250 to $1,500');
  });

  it('reads a ceiling however the page words it', () => {
    expect(fromProse('Grants of up to $1,000 may be made to support research.')).toBe(
      'Up to $1,000',
    );
    expect(fromProse('Awards are issued in April, with funds rarely exceeding $4,000.')).toBe(
      'Up to $4,000',
    );
    expect(fromProse('The maximum fellowship grant is $1,500.')).toBe('Up to $1,500');
  });

  it('keeps "typically", "about", an average and a per-unit qualifier where stated', () => {
    expect(fromProse('Typical awards are about $3,000.')).toBe('Typically about $3,000');
    expect(fromProse('Grants will normally not exceed $5,000.')).toBe('Typically up to $5,000');
    expect(fromProse('The average award is $9,000.')).toBe('$9,000 on average');
    expect(fromProse('Fellows receive a $700/week stipend and a mentor.')).toBe('$700 per week');
    expect(fromProse('The award provides a stipend of $2,000 per month.')).toBe('$2,000 per month');
  });

  it('composes a range with the ceiling the same sentence sets', () => {
    expect(
      fromProse('Typical grants will be in the range of $500-$2500 with a $3000 maximum.'),
    ).toBe('Typically $500 to $2500, up to $3000');
  });

  it('keeps the audience of each amount when one sentence states two', () => {
    expect(
      fromProse(
        'Typical awards are about $3,000 for domestic projects and about $4,000 for travel abroad.',
      ),
    ).toBe('Typically about $3,000 for domestic projects; about $4,000 for travel abroad');
  });

  it('reads the same amount stated twice as one statement', () => {
    expect(
      fromProse(
        'Grants of up to $1,000 may be made to support research.',
        'Grants are typically awarded up to $1,000 to support research.',
      ),
    ).toBe('Up to $1,000');
  });

  it('does not read a figure that is not the award', () => {
    expect(
      fromProse('A low or unpaid internship is defined as earning $250 or less per week.'),
    ).toBe(undefined);
    expect(fromProse('For grant amounts over $600 the University issues a tax form.')).toBe(
      undefined,
    );
    expect(fromProse('In previous years, awards have ranged from $5,500 to $20,000.')).toBe(
      undefined,
    );
    expect(
      fromProse('Funds may be used for supplies, including up to $500/week for workspace.'),
    ).toBe(undefined);
    expect(fromProse('Note: language study grants can offer only up to $2,000.')).toBe(undefined);
    expect(fromProse('The fund has an endowment of $2 million and supports research.')).toBe(
      undefined,
    );
  });

  it('keeps the award beside a component it names separately', () => {
    expect(
      fromProse(
        'Each fellowship provides a stipend of $60,000 and a health-care contribution of up to $5,000.',
      ),
    ).toBe('$60,000');
    expect(fromProse('Fellows receive a relocation stipend of up to $1,500.')).toBe(undefined);
  });

  it('abstains when the statements disagree or a figure goes unaccounted for', () => {
    expect(
      proseAwardAmount([
        'Short projects receive an award in the range of $600 - $1,800.',
        'Long projects receive an award in the range of $4,000 - $5,000.',
      ]),
    ).toEqual({ kind: 'abstained', reason: 'conflicting' });
    expect(
      proseAwardAmount(['Each scholar receives a $5,000 grant and an additional $30,000 later.']),
    ).toEqual({ kind: 'abstained', reason: 'unaccounted' });
    expect(
      proseAwardAmount(['The cumulative value of the scholarship is approximately $42,000.']),
    ).toEqual({ kind: 'abstained', reason: 'unaccounted' });
  });

  it('is silent on prose that states no dollar amount', () => {
    expect(proseAwardAmount(['The fellowship supports summer research.'])).toEqual({
      kind: 'silent',
    });
  });
});

describe('the header and the prose together (#4588)', () => {
  it('keeps a header the page states', () => {
    expect(fundAwardAmount('Up to $2,500', ['Grants of up to $2,000 support research.'])).toBe(
      'Up to $2,500',
    );
  });

  it('serves the prose range when the header is only its top figure', () => {
    expect(fundAwardAmount('$5000', ['Grants range from $500 to $5000.'])).toBe('$500 to $5000');
    expect(fundAwardAmount('5,000', ['Funding of up to $5,000 is available.'])).toBe(
      'Up to $5,000',
    );
  });

  it('keeps a bare header the prose does not bound', () => {
    expect(fundAwardAmount('$3,000', ['Grants range from $500 to $5000.'])).toBe('$3,000');
    expect(fundAwardAmount('$4,500', ['Fellows receive a stipend of $4,500.'])).toBe('$4,500');
  });
});
