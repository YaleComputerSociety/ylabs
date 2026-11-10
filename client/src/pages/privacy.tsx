import useDocumentTitle from '../hooks/useDocumentTitle';
import { EXTERNAL_LINK_REL } from '../utils/url';
import {
  ACTIVITY_RECORD_RETENTION_DAYS_LABEL,
  PRIVACY_PAGE_TITLE,
  PRIVACY_QUESTIONS_URL,
  SESSION_COOKIE_LIFETIME_DAYS,
} from '../utils/privacyNotice';

const SECTION_HEADING_CLASS = 'text-xl font-semibold text-ink';
const BODY_CLASS = 'mt-3 text-base leading-relaxed text-ink-soft';
const LIST_CLASS = 'mt-3 list-disc space-y-2 pl-5 text-base leading-relaxed text-ink-soft';

const Section = ({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) => (
  <section className="mt-10" aria-labelledby={id}>
    <h2 id={id} className={SECTION_HEADING_CLASS}>
      {title}
    </h2>
    {children}
  </section>
);

const Privacy = () => {
  useDocumentTitle(PRIVACY_PAGE_TITLE);
  return (
    <div className="yr-page flex min-h-screen flex-col items-center px-5 py-8 sm:px-8">
      <article className="yr-panel w-full max-w-3xl rounded-card p-5 sm:p-8">
        <p className="yr-kicker mb-3">Privacy</p>
        <h1 className="yr-display text-4xl font-semibold leading-tight text-ink sm:text-5xl sm:leading-none">
          What y/labs collects
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink-soft">
          y/labs is a student-built directory of research at Yale. This page lists what it collects
          when you use it, who receives it, and how long it is kept. It describes the site as it
          runs today.
        </p>

        <Section id="browsing" title="If you browse without signing in">
          <p className={BODY_CLASS}>
            y/labs keeps no record of who you are or what you looked at. It does set one cookie,
            which carries only a random id used to limit how fast one browser can send requests, and
            your browser keeps a few y/labs settings, such as display preferences and whether you
            were last signed in. Two things still leave your browser:
          </p>
          <ul className={LIST_CLASS}>
            <li>
              The text of a research search is sent to OpenAI to turn it into a search vector. The
              request carries the search text only, with no account or browser identifier.
            </li>
            <li>
              Fonts load from Google Fonts, and some photos load from Yale, Cloudinary and Yalies.
              As with any web page, those servers see your IP address when your browser fetches
              them.
            </li>
          </ul>
        </Section>

        <Section id="signing-in" title="When you sign in">
          <p className={BODY_CLASS}>
            Sign-in goes through Yale CAS, so y/labs never sees your password. At each sign-in
            y/labs looks you up on Yalies and stores your netid, email address, first and last name,
            and your role at Yale, such as student or faculty. Your saved research, plans, stages
            and notes are stored with your account until you delete them.
          </p>
          <p className={BODY_CLASS}>
            Signing in adds your account to the same y/labs cookie, which keeps you signed in for up
            to {SESSION_COOKIE_LIFETIME_DAYS} days.
          </p>
        </Section>

        <Section id="activity" title="Your activity on y/labs">
          <p className={BODY_CLASS}>
            While you are signed in, y/labs records what you do on it: the searches you run,
            including their text and filters, the results you see, the pages you open, the links you
            follow, and what you save, compare or plan. Each record is kept with your netid for{' '}
            {ACTIVITY_RECORD_RETENTION_DAYS_LABEL} days (three years) and then deleted
            automatically.
          </p>
          <p className={BODY_CLASS}>
            y/labs administrators can read these records, including one student&apos;s activity, to
            understand how the site is used and to improve search. They are not shared outside
            y/labs.
          </p>
        </Section>

        <Section id="product-analytics" title="Product analytics and session replay">
          <p className={BODY_CLASS}>
            On yalelabs.io, and only while you are signed in, y/labs uses PostHog, a product
            analytics service, to see where students click and where pages are slow or broken. It
            does not run on any other copy of the site, or for administrators.
          </p>
          <ul className={LIST_CLASS}>
            <li>
              PostHog receives page views, clicks, page speed, errors, and a replay of how the page
              moved. The replay masks all text and everything you type, and records no request
              bodies or headers.
            </li>
            <li>
              Web addresses are sent without their search terms, and your netid is removed from
              everything sent. PostHog knows you only by a random id that y/labs assigns, plus your
              role at Yale.
            </li>
            <li>
              PostHog stores nothing in your browser: no cookie and no local storage. It does not
              run if your browser sends Do Not Track.
            </li>
            <li>
              PostHog runs in the United States, does not keep your IP address, and keeps this data
              for no longer than the {ACTIVITY_RECORD_RETENTION_DAYS_LABEL} days y/labs keeps its
              own records.
            </li>
          </ul>
        </Section>

        <Section id="error-reports" title="Error reports">
          <p className={BODY_CLASS}>
            When the site breaks, an error report can be sent to Sentry so it can be fixed. A report
            carries the error, the page address with ids and search terms removed, your browser
            type, and the pages you moved between just before it. It carries no account details, no
            cookies and no request contents.
          </p>
        </Section>

        <Section id="questions" title="Questions">
          <p className={BODY_CLASS}>
            To ask about this page or about data y/labs holds about you, open an issue on the{' '}
            <a
              href={PRIVACY_QUESTIONS_URL}
              target="_blank"
              rel={EXTERNAL_LINK_REL}
              className="yr-link yr-focus-ring rounded-control"
            >
              y/labs GitHub repository
            </a>
            . Issues there are public, so do not include personal details in one.
          </p>
        </Section>
      </article>
    </div>
  );
};

export default Privacy;
