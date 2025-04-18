import DeveloperCard from "../components/DeveloperCard";

const About = () => {
    return (
        <div className="flex flex-col items-center p-8 min-h-screen mt-24">
            <div className="max-w-5xl text-center">
                <h1 className="text-4xl font-bold mb-7">Welcome to Yale Labs! 🔬</h1>
                <p className="text-lg text-gray-700 mb-10 leading-relaxed">
                    A collaboration between the{" "}
                    <a
                        href={"https://yalecomputersociety.org/"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500"
                    >
                        Yale Computer Society
                    </a>
                    {" "}and the{" "}
                    <a
                        href={"https://www.yura.yale.edu/"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500"
                    >
                        Yale Undergraduate Research Association
                    </a>
                    , Yale Labs brings students a single, 
                    streamlined platform to browse research opportunities at Yale! With a mix of lab listings submitted by professors and scraped 
                    from the internet, our mission at Yale Labs is to make finding your next lab as stress-free as possible with all the information you 
                    need in one place.
                </p>
                <h1 className="text-3xl font-bold mb-7">Help us with our first release!</h1>
                <p className="text-lg text-gray-700 mb-10 leading-relaxed">
                    While we are working dilligently to get more up-to-date listings on the site, 
                    we are also working on changes to improve the browsing experience! As you look 
                    around the site, please let us know in the{" "}
                    <a
                        href={"https://docs.google.com/forms/d/e/1FAIpQLSf2BE6MBulJHWXhDDp3y4Nixwe6EH0Oo9X1pTo976-KrJKv5g/viewform?usp=dialog"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500"
                    >
                        feedback form
                    </a>
                    {" "}if there is anything that is broken, annoying, or that you would like to see
                    added to the site.
                </p>
                <a href="https://yalecomputersociety.org/" target="_blank" rel="noopener noreferrer">
                    <img src="/assets/icons/ycs-icon.png" alt="y/cs Website" width={40} height={40} className="inline-block mx-2"/>
                </a>
                <a href="https://www.yura.yale.edu/" target="_blank" rel="noopener noreferrer">
                    <img src="/assets/icons/yura-icon.png" alt="YURA Website" width={32} height={40} className="inline-block mx-2"/>
                </a>
                <a href="https://github.com/YaleComputerSociety/ylabs" target="_blank" rel="noopener noreferrer">
                    <img src="/assets/icons/github-icon.png" alt="RDB Github" width={40} height={40} className="inline-block mx-2"/>
                </a>
            </div>
            <div className="max-w-6xl text-center mt-16">
                <h2 className="text-3xl font-bold mb-10">Meet our team</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-16">
                    {currentDevelopers.map((developer) => (
                        <div key={developer.name} className="bg-gray-50 p-3 rounded-lg shadow-md">
                            <DeveloperCard developer={developer}></DeveloperCard>
                        </div>
                    ))}
                </div>
                <h2 className="text-3xl font-bold mb-10">RDB alumni</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    {pastDevelopers.map((developer) => (
                        <div key={developer.name} className="bg-gray-50 p-3 rounded-lg shadow-md">
                            <DeveloperCard developer={developer}></DeveloperCard>
                        </div>
                    ))}
                </div>
            </div>
            
        </div>
    );
};

const currentDevelopers = [
    {
        name: "Ryan Fernandes",
        position: "Development Lead",
        image: "/assets/developers/RyanFernandes.jpeg",
        location: "Natick, MA",
        linkedin: "https://www.linkedin.com/in/ryan-fernandes-088109284/",
        github: "https://github.com/Ryfernandes",
    },
    {
        name: "Sebastian Gonzalez",
        image: "/assets/developers/SebastianGonzalez.jpeg",
        position: "Developer",
        location: "Montclair, NJ",
        github: "https://github.com/Seb-G0",
        linkedin: "https://www.linkedin.com/in/sebastian-ravi-gonzalez/",
    },
    {
        name: "Dohun Kim",
        position: "Developer",
        image: "/assets/developers/DohunKim.jpeg",
        location: "Anyang-si, South Korea",
        github: "https://github.com/rlaehgnss",
        linkedin: "https://www.linkedin.com/in/dohun-kim-848028251/",
    },
    {
        name: "Alan Zhong",
        image: "/assets/developers/AlanZhong.jpeg",
        position: "Developer",
        location: "Basking Ridge, NJ",
        github: "https://github.com/azh248",
        linkedin: "https://www.linkedin.com/in/azhong248/",
    },
    {
        name: "Quntao Zheng",
        image: "/assets/developers/QuntaoZheng.jpeg",
        position: "Developer",
        location: "New York, NY",
        github: "https://github.com/quntao-z",
        linkedin: "https://www.linkedin.com/in/quntao-zheng/",
    },
    {
        name: "Christian Phanhthourath",
        position: "Developer",
        image: "/assets/developers/ChristianPhanhthourath.jpeg",
        location: "Marietta, GA",
        github: "https://github.com/cphanhth",
        linkedin: "https://linkedin.com/in/christianphanhthourath",
    },
    {
        name: "Christina Xu",
        position: "Developer",
        image: "/assets/developers/ChristinaXu.jpeg",
        location: "Lincoln, Nebraska",
        github: "https://github.com/shadaxiong",
    }
]

const pastDevelopers = [
    {
        name: "Julian Lee",
        position: "RDB Founder",
        location: "New York, NY",
        github: "https://github.com/JulianLee123",
    },
    {
        name: "Miles Yamner",
        position: "Developer",
        location: "New York, NY",
    },
    {
        name: "Landon Hellman",
        position: "Developer",
        location: "Santa Barbara, CA",
    }
]

export default About;