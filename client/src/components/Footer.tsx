/**
 * Site footer displaying the privacy link and sponsor logos.
 */
import { Link } from 'react-router-dom';

import { PRIVACY_LINK_LABEL, PRIVACY_PATH } from '../utils/privacyNotice';
import Wordmark from './Wordmark';

const Footer = () => {
  return (
    <footer className="mt-auto border-t border-[var(--yr-border-warm)] bg-[var(--yr-page)] py-5">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
        <div className="flex items-center gap-2 text-[var(--yr-blue)]">
          <img src="/brand/yale-research-mark.svg" alt="" width={24} height={24} />
          <Wordmark className="text-lg" />
        </div>
        <Link
          to={PRIVACY_PATH}
          className="yr-link yr-focus-ring inline-flex min-h-[44px] items-center rounded-control px-2 text-sm"
        >
          {PRIVACY_LINK_LABEL}
        </Link>
        <div className="flex items-center justify-center gap-4">
          <a
            href="https://www.hudsonrivertrading.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="yr-focus-ring inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md"
          >
            <img
              src="/assets/logos/HudsonRiverTrading.png"
              alt="Hudson River Trading"
              width={40}
              height={40}
              className="transition-opacity hover:opacity-80"
            />
          </a>
          <a
            href="https://www.minimax.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="yr-focus-ring inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md"
          >
            <img
              src="/assets/logos/MiniMax.png"
              alt="MiniMax"
              width={40}
              height={40}
              className="transition-opacity hover:opacity-80"
            />
          </a>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
