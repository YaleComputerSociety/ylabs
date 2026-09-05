/**
 * Navigation button for the About page with active-state highlighting.
 */
import Button from '@mui/material/Button';
import { Link, useLocation } from 'react-router-dom';
import { navFocusRingSx } from '../utils/focusRing';

const AboutButton = () => {
  const location = useLocation();
  const isActive = location.pathname === '/about';

  const handleClick = (event: React.MouseEvent) => {
    if (isActive) {
      event.preventDefault();
    }
  };

  return (
    <Button
      color="inherit"
      component={Link}
      to="/about"
      onClick={handleClick}
      sx={{
        textTransform: 'none',
        color: isActive ? 'var(--yr-blue)' : 'var(--yr-ink)',
        fontFamily: 'Inter',
        fontWeight: 450,
        fontSize: '14px',
        minHeight: '44px',
        '&:hover': {
          backgroundColor: 'transparent',
          color: 'var(--yr-blue)',
        },
        ...navFocusRingSx,
      }}
      disableRipple={true}
    >
      About
    </Button>
  );
};

export default AboutButton;
