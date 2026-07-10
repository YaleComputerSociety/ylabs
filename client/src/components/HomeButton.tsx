/**
 * Logo home button that navigates to the primary research discovery page.
 */
import Button from '@mui/material/Button';
import { Link, useLocation } from 'react-router-dom';

const HomeButton = () => {
  const location = useLocation();

  const handleClick = (event: React.MouseEvent) => {
    if (location.pathname === '/research') {
      event.preventDefault();
      window.location.reload();
    }
  };

  return (
    <Button
      component={Link}
      to="/research"
      onClick={handleClick}
      disableRipple={true}
      sx={{
        '&:hover': { backgroundColor: 'transparent' },
        textTransform: 'none',
        minWidth: 'auto',
        minHeight: '44px',
        padding: { xs: '6px 10px 6px 0px', sm: '6px 16px 6px 0px' },
        marginLeft: { xs: '-10px', sm: '-16px' },
      }}
    >
      <img
        src="/brand/yale-research-mark.svg"
        alt=""
        className="mr-2"
        style={{ width: '32px', height: '32px' }}
      />
      <span className="yr-wordmark text-xl text-[var(--yr-blue)] sm:text-[1.35rem]">
        Yale Research
      </span>
    </Button>
  );
};

export default HomeButton;
