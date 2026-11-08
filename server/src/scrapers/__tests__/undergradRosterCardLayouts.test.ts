import { describe, expect, it } from 'vitest';
import { proposeUndergradRosterConfig } from '../undergradRosterDerivation';

const observedAt = new Date('2026-11-08T12:00:00Z');
const proposed = (html: string) => {
  const outcome = proposeUndergradRosterConfig(
    html,
    'fixture-lab',
    'https://fixturelab.example.org/team',
    observedAt,
  );
  return outcome.kind === 'proposed'
    ? outcome.roster.undergraduates.map(({ name, status }) => `${name}:${status}`)
    : [];
};

describe('roster card layouts (#5503)', () => {
  it('never reads a photo caption naming a group as the previous person’s role', () => {
    expect(
      proposed(`<html><body><main><h2>Fixture Lab UW-Elsewhere Alumni</h2>
        <p>Harper Wren</p><p>Graduate Student</p><img alt="">
        <p>Avery Quill</p><p>Undergraduate Researcher</p><img alt="">
        <p>fixture design team</p><p>Undergrads</p>
      </main></body></html>`),
    ).toEqual(['Avery Quill:past']);
  });

  it('reads the biography under a name and role, so a student elsewhere is withheld', () => {
    const card = (name: string, bio: string) =>
      `<div><img alt=""><div><h3>${name}</h3>Undergraduate intern<div>${bio}</div></div></div>`;
    expect(
      proposed(`<html><body><main><h2>Our Team</h2>
        ${card('Avery Quill', 'Avery is an undergraduate student at Yale University who is excited to join the lab.')}
        ${card('Harper Wren', 'Harper is completing her undergraduate degree at the University of Elsewhere, studying piano.')}
      </main></body></html>`),
    ).toEqual(['Avery Quill:current']);
  });
});
