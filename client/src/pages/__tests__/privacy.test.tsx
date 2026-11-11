import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import ConfigContext, { defaultConfigContext } from '../../contexts/ConfigContext';
import Privacy from '../privacy';
import { PRIVACY_CONTACT_EMAIL, PRIVACY_CONTACT_MAILTO } from '../../utils/privacyContact';
import { PRIVACY_QUESTIONS_URL } from '../../utils/privacyNotice';
import { expectNoAxeViolations } from '../../testUtils/axe';

afterEach(() => {
  cleanup();
});

const renderPrivacy = (
  accountDataControls = false,
  selfServeAccountDeletion = accountDataControls,
) =>
  render(
    <MemoryRouter initialEntries={['/privacy']}>
      <ConfigContext.Provider
        value={{
          ...defaultConfigContext,
          features: { accountDataControls },
          selfServeAccountDeletion,
        }}
      >
        <Privacy />
      </ConfigContext.Provider>
    </MemoryRouter>,
  );

describe('Privacy', () => {
  it('names every service that receives data and how long activity is kept', () => {
    renderPrivacy();

    expect(screen.getByRole('heading', { level: 1, name: 'What y/labs collects' })).toBeTruthy();
    const text = document.body.textContent ?? '';
    for (const service of ['PostHog', 'OpenAI', 'Sentry', 'Google Fonts', 'Yale CAS', 'Yalies']) {
      expect(text).toContain(service);
    }
    expect(text).toContain('1,095 days');
    expect(text).toContain('30 days');
    expect(text).toContain('yalelabs.io');
  });

  it('keeps the public issue tracker for general questions only', () => {
    renderPrivacy();

    const link = screen.getByRole('link', { name: 'y/labs GitHub repository' });
    expect(link.getAttribute('href')).toBe(PRIVACY_QUESTIONS_URL);
    expect(link.closest('p')?.textContent).toContain('For general questions');
    expect(link.closest('p')?.textContent).toContain(PRIVACY_CONTACT_EMAIL);
  });

  it('sends a private data request to the maintainer address, answered within 30 days', () => {
    renderPrivacy();

    const links = screen.getAllByRole('link', { name: PRIVACY_CONTACT_EMAIL });
    for (const mailbox of links) {
      expect(mailbox.getAttribute('href')).toBe(PRIVACY_CONTACT_MAILTO);
    }
    const link = links.find((candidate) =>
      candidate.closest('p')?.textContent?.includes('If you cannot sign in'),
    );
    const paragraph = link?.closest('p')?.textContent ?? '';
    expect(paragraph).toContain('If you cannot sign in');
    expect(paragraph).toContain('within 30 days');
    expect(paragraph).toContain('Do not send a request about your own data as a GitHub issue');
  });

  it('describes the dashboard deletion only while the release flag is on', () => {
    renderPrivacy(false);
    expect(document.body.textContent).not.toContain('under Your data');
    cleanup();

    renderPrivacy(true);
    const text = document.body.textContent ?? '';
    expect(text).toContain('under Your data');
    expect(text).toContain('enter your Yale password again');
    expect(text).toContain('a maintainer deletes that account too');
    expect(text).toContain('you type “delete my data”');
    expect(text).toContain('It usually takes effect at once');
    expect(text).toContain(
      'linked to an entry in the directory, y/labs tells you and you can email us',
    );
    expect(text).not.toContain('Deleting takes effect at once');
    expect(text).toContain('names you only by a one-way hash of your netid');
    expect(text).not.toContain('with nothing that identifies you');
    expect(text).toContain('anything you typed in the note stays');
    expect(text).toContain(
      'If you were a y/labs administrator, your administrator access is revoked rather than deleted, and the records of administrator actions you took still name your netid.',
    );
    expect(screen.getAllByRole('link', { name: PRIVACY_CONTACT_EMAIL }).length).toBeGreaterThan(0);
  });

  it('tells a listed person how to ask to be removed, and says what a request stores', () => {
    renderPrivacy();

    const text = document.body.textContent ?? '';
    expect(text).toContain(
      'If y/labs lists you and you would like to be removed, sign in and use Remove me on your dashboard, or email ycs.maintenance.ylabs@gmail.com from the address Yale publishes for you.',
    );
    expect(text).toContain(
      'If you ask to be removed from y/labs, the request stores only your netid, the listing it matched, the request status, when it was made and decided, and which maintainer decided it.',
    );
  });

  it('describes the cookies, the stored sign-in fields, and what a listed person can do', () => {
    renderPrivacy();

    const text = document.body.textContent ?? '';
    expect(text).toContain('It does set a session cookie and its signature');
    expect(text).not.toContain('It does set one cookie');
    expect(text).toContain('If you work at Yale, it also stores your job title and department.');
    expect(text).toContain('a random token that shows the request came from y/labs');
    expect(screen.getByRole('heading', { level: 2, name: 'If y/labs lists you' })).toBeTruthy();
    expect(text).toContain(
      'y/labs builds its directory from public Yale web pages (official profiles, department and lab pages, roster lists), from the Yalies directory, and from public grant records. Maintainers refresh it from time to time, not on a fixed schedule.',
    );
    expect(text).not.toContain('publication records');
    expect(text).toContain('use Report an issue with this page on the listing');
    expect(text).toContain('A maintainer applies an accepted request within 7 days.');
    expect(text).toContain(
      'PostHog keeps session replays for 30 days and other events for 1 year.',
    );
    expect(text).not.toContain('keeps this data for no longer than');
    expect(text).toContain(
      'Your netid is removed from the events y/labs sends, and PostHog knows you only by a random id plus your role at Yale. Web addresses are sent without their search terms, and if you arrive from a search engine, the words you searched for there are removed before anything reaches PostHog.',
    );
    expect(text).not.toContain('can still reach PostHog');
    expect(text).not.toContain('removed from everything sent');
  });

  it('names what the signed-in session cookie holds', () => {
    renderPrivacy();

    const text = document.body.textContent ?? '';
    expect(text).toContain(
      'Signing in adds your netid and your role at Yale to the same session cookie, beside the random id,',
    );
    expect(text).toContain('keeps you signed in for up to 30 days');
    expect(text).not.toContain('adds your sign-in to the same session cookie');
  });

  it('says a removal keeps only keyed hashes of each identifier it matches on', () => {
    renderPrivacy();

    expect(document.body.textContent).toContain(
      'The removal itself keeps only one-way keyed hashes of your netid, email, ORCID iD, profile links and name, so y/labs can keep leaving you out.',
    );
  });

  it('tells both students and listed people what reaches OpenAI', () => {
    renderPrivacy();

    const text = document.body.textContent ?? '';
    expect(text).toContain(
      'The text of a research search is sent to OpenAI to turn it into a search vector',
    );
    expect(text).toContain('When result reordering is turned on');
    expect(text).toContain(
      'Neither request carries your account or browser id, even when you are signed in.',
    );
    expect(text).toContain(
      'y/labs sends text from those public pages, including the names on them, to OpenAI',
    );
    expect(text).toContain('To build its search index, it also sends');
  });

  it('sends deletion to the mailbox when the server cannot delete, keeping the download', () => {
    renderPrivacy(true, false);

    const text = document.body.textContent ?? '';
    expect(text).toContain('you can download a copy');
    expect(text).toContain('To have it deleted, email the address below.');
    expect(text).not.toContain('enter your Yale password again');
    expect(text).not.toContain('asks PostHog to delete');
    expect(screen.getAllByRole('link', { name: PRIVACY_CONTACT_EMAIL }).length).toBeGreaterThan(0);
  });

  it('has no serious or critical accessibility violations', async () => {
    const { container } = renderPrivacy();
    await expectNoAxeViolations(container);
  });
});
