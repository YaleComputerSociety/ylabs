/**
 * Navigation button for the Analytics page with active-state highlighting.
 */
import Button from '@mui/material/Button';
import { Link, useLocation } from 'react-router-dom';

export default function AnalyticsButton() {
  const location = useLocation();
  const isActive = location.pathname === '/analytics';

  const handleClick = (event: React.MouseEvent) => {
    if (isActive) {
      event.preventDefault();
    }
  };

  return (
    <Button
      color="inherit"
      component={Link}
      to="/analytics"
      onClick={handleClick}
      sx={{
        textTransform: 'none',
        color: isActive ? '#1876D1' : '#000000',
        fontFamily: 'Inter',
        fontWeight: 450,
        fontSize: '14px',
        '&:hover': {
          backgroundColor: 'transparent',
          color: '#1876D1',
        },
      }}
      disableRipple={true}
    >
      Analytics
    </Button>
  );
}
