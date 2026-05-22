/**
 * About page displaying project information, sponsors, and developer team members.
 */
import DeveloperCard from '../components/DeveloperCard';
import useDocumentTitle from '../hooks/useDocumentTitle';

const About = () => {
  useDocumentTitle('About');
  return (
    <div className="yr-page flex min-h-screen flex-col items-center px-5 py-8 sm:px-8">
      <div className="yr-panel max-w-5xl rounded-md p-5 text-center sm:p-8">
        <p className="yr-kicker mb-3">About the project</p>
        <h1 className="mb-7 text-4xl font-semibold text-slate-950">Welcome to Yale Research</h1>
        <p className="mb-10 text-lg leading-relaxed text-slate-700">
          Yale Research is a{' '}
          <a
            href={'https://yalecomputersociety.org/'}
            target="_blank"
            rel="noopener noreferrer"
            className="yr-link rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            Yale Computer Society
          </a>{' '}
          product that gives students a single place to discover research structures, evidence,
          openings, and practical next steps at Yale. The goal is to help undergraduates move from a
          topic or method they care about to a credible research home without already knowing the
          right lab or professor name.
        </p>
        <h2 className="mb-7 text-3xl font-semibold text-slate-950">Help improve Yale Research</h2>
        <p className="mb-10 text-lg leading-relaxed text-slate-700">
          We are continuing to connect source-backed openings with broader research homes and
          pathways while improving the browsing experience. As you look around the site, please let
          us know in the{' '}
          <a
            href={
              'https://docs.google.com/forms/d/e/1FAIpQLSf2BE6MBulJHWXhDDp3y4Nixwe6EH0Oo9X1pTo976-KrJKv5g/viewform?usp=dialog'
            }
            target="_blank"
            rel="noopener noreferrer"
            className="yr-link rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            feedback form
          </a>{' '}
          if there is anything that is broken, annoying, or that you would like to see added to the
          site.
        </p>
        <a
          href="https://yalecomputersociety.org/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
        >
          <img
            src="/assets/icons/ycs-icon.png"
            alt="Yale Computer Society website"
            width={40}
            height={40}
            className="inline-block mx-2"
          />
        </a>
        <a
          href="https://www.yura.yale.edu/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
        >
          <img
            src="/assets/icons/yura-icon.png"
            alt="Yale Undergraduate Research Association website"
            width={32}
            height={40}
            className="inline-block mx-2"
          />
        </a>
        <a
          href="https://github.com/YaleComputerSociety/ylabs"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
        >
          <img
            src="/assets/icons/github-icon.png"
            alt="Yale Research GitHub"
            width={40}
            height={40}
            className="inline-block mx-2"
          />
        </a>
        <a
          href="https://www.hudsonrivertrading.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
        >
          <img
            src="/assets/logos/HudsonRiverTrading.png"
            alt="Hudson River Trading"
            width={40}
            height={40}
            className="inline-block mx-2"
          />
        </a>
        <a
          href="https://www.minimax.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
        >
          <img
            src="/assets/logos/MiniMax.png"
            alt="MiniMax"
            width={40}
            height={40}
            className="inline-block mx-2"
          />
        </a>
      </div>
      <div className="mt-16 max-w-6xl text-center">
        <h2 className="mb-10 text-3xl font-semibold text-slate-950">Meet our team</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-16">
          {currentDevelopers.map((developer) => (
            <div key={developer.name} className="yr-card rounded-md p-3">
              <DeveloperCard developer={developer}></DeveloperCard>
            </div>
          ))}
        </div>
        <h2 className="mb-10 text-3xl font-semibold text-slate-950">Yale Research alumni</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {pastDevelopers.map((developer) => (
            <div key={developer.name} className="yr-card rounded-md p-3">
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
    name: 'Ryan Fernandes',
    position: 'Development Lead',
    image: '/assets/developers/RyanFernandes.jpeg',
    location: 'Natick, MA',
    linkedin: 'https://www.linkedin.com/in/ryan-fernandes-088109284/',
    github: 'https://github.com/Ryfernandes',
  },
  {
    name: 'Sebastian Gonzalez',
    image: '/assets/developers/SebastianGonzalez.jpeg',
    position: 'Developer',
    location: 'Montclair, NJ',
    github: 'https://github.com/Seb-G0',
    linkedin: 'https://www.linkedin.com/in/sebastian-ravi-gonzalez/',
  },
  {
    name: 'Dohun Kim',
    position: 'Developer',
    image: '/assets/developers/DohunKim.jpeg',
    location: 'Anyang-si, South Korea',
    github: 'https://github.com/rlaehgnss',
    linkedin: 'https://www.linkedin.com/in/dohun-kim-848028251/',
  },
  {
    name: 'Alan Zhong',
    image: '/assets/developers/AlanZhong.jpeg',
    position: 'Developer',
    location: 'Basking Ridge, NJ',
    github: 'https://github.com/azh248',
    linkedin: 'https://www.linkedin.com/in/azhong248/',
  },
  {
    name: 'Quntao Zheng',
    image: '/assets/developers/QuntaoZheng.jpeg',
    position: 'Developer',
    location: 'New York, NY',
    github: 'https://github.com/quntao-z',
    linkedin: 'https://www.linkedin.com/in/quntao-zheng/',
  },
  {
    name: 'Christian Phanhthourath',
    position: 'Developer',
    image: '/assets/developers/ChristianPhanhthourath.jpeg',
    location: 'Marietta, GA',
    github: 'https://github.com/cphanhth',
    linkedin: 'https://linkedin.com/in/christianphanhthourath',
  },
  {
    name: 'Christina Xu',
    position: 'Developer',
    image: '/assets/developers/ChristinaXu.jpeg',
    location: 'Lincoln, Nebraska',
    github: 'https://github.com/shadaxiong',
  },
  {
    name: 'Chloe Wu',
    position: 'Developer',
    image: '/assets/developers/Chloe Wu.JPG',
    location: 'Corona, CA',
  },
  {
    name: 'David Sadka',
    position: 'Developer',
    image: '/assets/developers/David Sadka.png',
    location: 'Brookline, MA',
  },
  {
    name: 'Peter Yu',
    position: 'Developer',
    image: '/assets/developers/Peter Yu.png',
    location: 'Choudrant, LA',
    linkedin:
      'https://www.linkedin.com/in/peter-yu-395b641b4?utm_source=share_via&utm_content=profile&utm_medium=member_ios',
  },
  {
    name: 'Tanav Prabhu',
    position: 'Developer',
    image: '/assets/developers/Tanav Prabhu.jpg',
    location: 'Milton, GA',
    linkedin:
      'https://www.linkedin.com/in/tanavprabhu?utm_source=share_via&utm_content=profile&utm_medium=member_ios',
  },
];

const pastDevelopers = [
  {
    name: 'Julian Lee',
    position: 'Founder',
    location: 'New York, NY',
    github: 'https://github.com/JulianLee123',
  },
  {
    name: 'Miles Yamner',
    position: 'Developer',
    location: 'New York, NY',
  },
  {
    name: 'Landon Hellman',
    position: 'Developer',
    location: 'Santa Barbara, CA',
  },
];

export default About;
