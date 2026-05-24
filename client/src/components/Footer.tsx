/**
 * Site footer displaying sponsor logos.
 */
const Footer = () => {
  return (
    <footer className="mt-auto border-t border-gray-200 bg-white py-4">
      <div className="max-w-7xl mx-auto px-6 flex flex-col items-center justify-center">
        <div className="flex items-center justify-center gap-4">
          <a
            href="https://www.hudsonrivertrading.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center"
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
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center"
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
