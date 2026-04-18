/**
 * Sign out button triggering CAS logout.
 */
import Button from '@mui/material/Button';

import axios from '../utils/axios';

const SignOutButton = () => {
  const handleLogout = () => {
    const currentPath = window.location.pathname;

    if (currentPath !== '/login') {
      const returnUrl = window.location.origin + currentPath;
      localStorage.setItem('logoutReturnPath', returnUrl);
    }

    window.location.href = axios.defaults.baseURL + '/logout';
  };

  return (
    <Button
      color="inherit"
      sx={{
        textTransform: 'none',
        color: '#000000',
        fontFamily: 'Inter',
        fontWeight: 450,
        fontSize: '14px',
        '&:hover': {
          backgroundColor: 'transparent',
          color: '#1876D1',
        },
      }}
      onClick={handleLogout}
      disableRipple={true}
    >
      Logout
    </Button>
  );
};

export default SignOutButton;
