import { useEffect } from 'react';
import { Link, useLocation, useNavigationType } from 'react-router-dom';

import useDocumentTitle from '../hooks/useDocumentTitle';
import { linkedSectionElement } from '../utils/linkedSection';
import { scrollBehavior } from '../utils/scrollBehavior';
import { EXTERNAL_LINK_REL } from '../utils/url';
import {
  GETTING_STARTED_PAGE_TITLE,
  WHAT_IS_A_PI_SECTION_ID,
  YALE_COLLEGE_FIRST_YEAR_FELLOWSHIP_URL,
  YALE_COLLEGE_MENTOR_ADVICE_URL,
} from '../utils/gettingStartedGuide';

const SECTION_HEADING_CLASS = 'text-xl font-semibold text-ink';
const BODY_CLASS = 'mt-3 text-base leading-relaxed text-ink-soft';
const LIST_CLASS = 'mt-3 list-disc space-y-2 pl-5 text-base leading-relaxed text-ink-soft';

const ExternalLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a
    href={href}
    target="_blank"
    rel={EXTERNAL_LINK_REL}
    className="yr-link yr-focus-ring rounded-control"
  >
    {children}
  </a>
);

/**
 * Focus moves only on an in-app link, never on a document load or a history step, so a
 * first Tab still reaches the skip link (see skills/frontend-polish, Interactions).
 */
const useRevealLinkedSection = () => {
  const { hash } = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => {
    const heading = linkedSectionElement(hash);
    if (!heading) return;
    if (navigationType !== 'POP') heading.focus({ preventScroll: true });
    heading.scrollIntoView?.({ behavior: scrollBehavior(), block: 'start' });
  }, [hash, navigationType]);
};

const GettingStarted = () => {
  useDocumentTitle(GETTING_STARTED_PAGE_TITLE);
  useRevealLinkedSection();
  return (
    <div className="yr-page flex min-h-screen flex-col items-center px-5 py-8 sm:px-8">
      <article className="yr-panel w-full max-w-3xl rounded-card p-5 sm:p-8">
        <p className="yr-kicker mb-3">Guide</p>
        <h1 className="yr-display text-4xl font-semibold leading-tight text-ink sm:text-5xl sm:leading-none">
          How to get started in research
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink-soft">
          Most undergraduate research at Yale starts with a short email to a faculty member whose
          work interests you. This page answers the questions students ask before sending it. It is
          general advice: each lab, center, or professor sets their own rules, so their own page
          comes first.
        </p>

        <section className="mt-10" aria-labelledby="can-first-years-join">
          <h2 id="can-first-years-join" className={SECTION_HEADING_CLASS}>
            Can first-years join?
          </h2>
          <p className={BODY_CLASS}>
            Yes, first-years can do research at Yale, and Yale College funds it: the{' '}
            <ExternalLink href={YALE_COLLEGE_FIRST_YEAR_FELLOWSHIP_URL}>
              First-Year Summer Research Fellowship in the Sciences and Engineering
            </ExternalLink>{' '}
            is one example. Whether a particular group takes first-years is up to the person who
            leads it, and some ask for a specific course first. Ask in your email rather than
            assume, and if a page says it is not taking students, try another group.
          </p>
          <p className={BODY_CLASS}>
            Research is not only lab work. In the humanities and social sciences it often means
            helping with a faculty member&apos;s project, working with an archive or a dataset, or
            doing your own project under their supervision. The same first email works for all of
            them.
          </p>
        </section>

        <section className="mt-10" aria-labelledby={WHAT_IS_A_PI_SECTION_ID}>
          <h2 id={WHAT_IS_A_PI_SECTION_ID} tabIndex={-1} className={SECTION_HEADING_CLASS}>
            What is a PI?
          </h2>
          <p className={BODY_CLASS}>
            PI stands for principal investigator: the faculty member who leads a lab or research
            project and is responsible for it. The PI usually decides who joins. In a larger lab,
            the person you work with day to day may be a postdoc, a graduate student, or a lab
            manager.
          </p>
          <p className={BODY_CLASS}>
            A center or institute is usually led by a director. It may coordinate student
            involvement centrally, so check its own page for a contact before emailing the director.
          </p>
        </section>

        <section className="mt-10" aria-labelledby="before-you-write">
          <h2 id="before-you-write" className={SECTION_HEADING_CLASS}>
            Before you write
          </h2>
          <ul className={LIST_CLASS}>
            <li>
              Read the description and the official pages linked from the y/labs page. Skim one or
              two recent papers or projects, and note what caught your interest.
            </li>
            <li>
              Pick a few groups, not one. Not every email gets an answer, and that is rarely
              personal.
            </li>
            <li>
              Check the group&apos;s own site for a &ldquo;join&rdquo; or
              &ldquo;opportunities&rdquo; page. If it describes how to apply, follow that instead of
              emailing.
            </li>
          </ul>
        </section>

        <section className="mt-10" aria-labelledby="first-email">
          <h2 id="first-email" className={SECTION_HEADING_CLASS}>
            How to write the first email
          </h2>
          <ul className={LIST_CLASS}>
            <li>
              A subject that says what you want, such as &ldquo;Undergraduate interested in your
              research&rdquo;.
            </li>
            <li>One sentence on who you are: your year and your major or likely major.</li>
            <li>
              One or two sentences on why this group, naming something specific from their work. A
              specific sentence shows you read it.
            </li>
            <li>
              What you are asking for: a short conversation about whether there is a way to get
              involved, now or in a later term.
            </li>
            <li>
              Relevant courses or skills, if you have any. Having no research experience yet is
              normal. Attach a resume if you have one.
            </li>
            <li>Keep it under about 150 words.</li>
          </ul>
          <figure className="mt-5 rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] p-4">
            <figcaption className="text-xs font-semibold uppercase tracking-wider text-muted">
              Example to adapt
            </figcaption>
            <div className="mt-3 space-y-3 text-base leading-relaxed text-ink">
              <p>Dear Professor [last name],</p>
              <p>
                I am a [first-year] in Yale College thinking about majoring in [subject]. I read
                about your work on [specific project or paper], and I was especially interested in
                [one specific point].
              </p>
              <p>
                I would love to learn whether there might be a way for an undergraduate to get
                involved in your research, this term or later. I have taken [relevant course], and I
                have attached my resume. Would you have 15 minutes to talk in the next few weeks?
              </p>
              <p>
                Thank you for your time,
                <br />
                [Your name]
              </p>
            </div>
          </figure>
        </section>

        <section className="mt-10" aria-labelledby="pay-and-credit">
          <h2 id="pay-and-credit" className={SECTION_HEADING_CLASS}>
            Pay, credit, and hours
          </h2>
          <p className={BODY_CLASS}>
            Some positions are paid, some count for course credit, and some are volunteer, and the
            hours expected vary by group. It is fine to ask once you are talking with them, and
            funded programs on the programs board are another way to be paid for a summer.
          </p>
        </section>

        <section className="mt-10" aria-labelledby="no-reply">
          <h2 id="no-reply" className={SECTION_HEADING_CLASS}>
            If you do not hear back
          </h2>
          <p className={BODY_CLASS}>
            Faculty get a lot of email. Wait about a week, then send one short, polite follow-up. If
            there is still no answer, move on to the next group on your list.
          </p>
        </section>

        <section className="mt-10" aria-labelledby="other-ways-in">
          <h2 id="other-ways-in" className={SECTION_HEADING_CLASS}>
            Other places to ask
          </h2>
          <ul className={LIST_CLASS}>
            <li>
              Your department&apos;s Director of Undergraduate Studies (DUS), a professor, or a
              teaching fellow from a course you liked can often point you to faculty who take
              students.
            </li>
            <li>
              <Link to="/programs" className="yr-link yr-focus-ring rounded-control">
                Programs and fellowships
              </Link>{' '}
              lists funded research programs, including ones open to first-years.
            </li>
            <li>
              Yale College&apos;s own advice on{' '}
              <ExternalLink href={YALE_COLLEGE_MENTOR_ADVICE_URL}>
                choosing a faculty mentor
              </ExternalLink>{' '}
              covers the same steps in more depth.
            </li>
          </ul>
        </section>

        <p className="mt-10">
          <Link
            to="/research"
            className="yr-pressable yr-focus-ring inline-flex min-h-11 items-center justify-center rounded-control bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy"
          >
            Find research to reach out to
          </Link>
        </p>
      </article>
    </div>
  );
};

export default GettingStarted;
