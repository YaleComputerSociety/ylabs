/**
 * Sign out button triggering CAS logout.
 */
import Button from '@mui/material/Button';

import { buildApiUrl } from '../utils/apiBaseUrl';
import { navFocusRingSx } from '../utils/focusRing';

const MAX_LOGOUT_RETURN_PATH_LENGTH = 2048;

const storeLogoutReturnPath = () => {
  if (window.location.pathname === '/login') return;

  const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  localStorage.removeItem('logoutReturnPath');
  if (returnPath.length <= MAX_LOGOUT_RETURN_PATH_LENGTH) {
    sessionStorage.setItem('logoutReturnPath', returnPath);
  }
};

const SignOutButton = () => {
  const handleLogout = () => {
    storeLogoutReturnPath();
    window.location.href = buildApiUrl('/logout');
  };

  return (
    <Button
      color="inherit"
      sx={{
        textTransform: 'none',
        color: 'var(--yr-ink)',
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
      onClick={handleLogout}
      disableRipple={true}
    >
      Logout
    </Button>
  );
};

export default SignOutButton;
