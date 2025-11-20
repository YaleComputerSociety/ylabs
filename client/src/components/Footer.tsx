const Footer = () => {
    return (
        <footer className="bg-white border-t border-gray-200 py-6 mt-auto">
            <div className="max-w-7xl mx-auto px-6 flex flex-col items-center justify-center">
                <div className="flex items-center justify-center gap-4 mb-4">
                    <a href="https://www.hudsonrivertrading.com/" target="_blank" rel="noopener noreferrer">
                        <img src="/assets/logos/HudsonRiverTrading.png" alt="Hudson River Trading" width={40} height={40} className="hover:opacity-80 transition-opacity"/>
                    </a>
                    <a href="https://www.minimax.com/" target="_blank" rel="noopener noreferrer">
                        <img src="/assets/logos/MiniMax.png" alt="MiniMax" width={40} height={40} className="hover:opacity-80 transition-opacity"/>
                    </a>
                    <a href="https://github.com/YaleComputerSociety/ylabs" target="_blank" rel="noopener noreferrer">
                        <img src="/assets/icons/github-icon.png" alt="GitHub" width={40} height={40} className="hover:opacity-80 transition-opacity"/>
                    </a>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    © {new Date().getFullYear()} Yale Labs. All rights reserved.
                </p>
            </div>
        </footer>
    );
};

export default Footer;
