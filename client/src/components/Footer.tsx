import { NavLink } from 'react-router-dom';
import clsx from 'clsx';

import 'bootstrap/dist/css/bootstrap.min.css';
import { Container } from 'react-bootstrap';
import styles from './Footer.module.css';


const links = [
  {
    section: 'Explore',
    items: [
      { name: 'Find Labs', to: ''},
      { name: 'My Labs', to: '/account' },
    ],
  },
  {
    section: 'Support',
    items: [
      { name: 'FAQ', to: '/faq' },
      { name: 'Feedback', to: 'https://docs.google.com/forms/d/e/1FAIpQLSf2BE6MBulJHWXhDDp3y4Nixwe6EH0Oo9X1pTo976-KrJKv5g/viewform' },
    ],
  },
  {
    section: 'About',
    items: [
      { name: 'Team', to: '/about' },
      { name: 'GitHub', to: 'https://github.com/YaleComputerSociety/ylabs' },

    ],
  },
  {
    section: 'Join Us',
    items: [
        { name: 'Application', to: '/joinus'},
        { name: 'Y/CS', to: 'https://yalecomputersociety.org/'},
        { name: 'YURA', to: 'https://www.yura.yale.edu/'},
    ],
  },
];

function Footer() {
  return (
    <Container fluid>
      <footer className={clsx(styles.footer, 'py-5 px-5')}>
        <div className="row justify-content-center">
            <div className="col-12 col-md">
            <img src="/assets/logos/ylabs-temp-blue.png"  alt="Ylabs Logo" style={{ height: "35px" }}/>
            <small className="d-block mb-3">
              &copy; {new Date().getFullYear()}
            </small>

            <div className="mt-3">
              <a href="https://www.buymeacoffee.com/coursetable">
                <img
                  style={{ height: '2.5rem' }}
                  src="https://img.buymeacoffee.com/button-api/?text=Buy us a textbook&emoji=?&slug=coursetable&button_colour=1084ff&font_colour=ffffff&font_family=Cookie&outline_colour=ffffff&coffee_colour=FFDD00"
                  alt="Buy us a textbook"
                />
              </a>
            </div>

            </div>
          {links.map(({ section, items }) => (
            <div key={section} className="col-6 col-md">
              <h5 className={styles.sectionHeading}>{section}</h5>
              <ul className="list-unstyled text-small">
              {items.map(({ name, to }) => (
                <li key={name}>
                    {to.startsWith('https:') ? (
                    <a href={to} rel="noopener noreferrer" target="_blank">
                        {name} {/* Display link text */}
                    </a>
                    ) : (
                    <NavLink to={to}>
                        {name} {/* Display link text */}
                    </NavLink>
                    )}
                </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </footer>
    </Container>
  );
}

export default Footer;