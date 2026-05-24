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
        padding: '6px 16px 6px 0px',
        marginLeft: '-16px',
      }}
    >
      <img
        src="/assets/logos/paperclip.png"
        alt=""
        className="mr-2"
        style={{ width: '31.65px', height: '27px' }}
      />
      <span className="text-xl font-semibold tracking-normal text-blue-700">
        Yale Research
      </span>
    </Button>
  );
};

export default HomeButton;
