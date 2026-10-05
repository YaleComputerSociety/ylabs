/**
 * Sign in button redirecting to Yale CAS.
 */
import Button from '@mui/material/Button';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { buildApiUrl } from '../utils/apiBaseUrl';
import { navFocusRingSx } from '../utils/focusRing';
import { normalizeReturnPath } from '../utils/returnPath';

interface SignInButtonProps {
  label?: string;
}

const SignInButton = ({ label = 'Sign in with Yale CAS' }: SignInButtonProps) => {
  const location = useLocation();
  const locationState = location.state as { from?: string } | null;
  const [mountReturn] = useState(() => ({
    savedPath: sessionStorage.getItem('logoutReturnPath'),
    from: locationState?.from,
  }));
  const fromChangedSinceMount = locationState?.from !== mountReturn.from;
  const returnPath = normalizeReturnPath(
    fromChangedSinceMount ? locationState?.from : mountReturn.savedPath || locationState?.from,
  );
  const redirectParam = returnPath ? `?redirect=${encodeURIComponent(returnPath)}` : '';

  useEffect(() => {
    if (mountReturn.savedPath) sessionStorage.removeItem('logoutReturnPath');
    localStorage.removeItem('logoutReturnPath');
  }, [mountReturn, locationState?.from]);

  const finalUrl = buildApiUrl(`/cas${redirectParam}`);

  return (
    <Button
      variant="contained"
      href={finalUrl}
      className="min-h-[44px]"
      sx={{
        minHeight: 44,
        borderRadius: '6px',
        backgroundColor: 'var(--yr-blue)',
        boxShadow: 'none',
        fontWeight: 700,
        textTransform: 'none',
        '&:hover': {
          backgroundColor: 'var(--yr-navy)',
          boxShadow: 'none',
        },
        ...navFocusRingSx,
      }}
    >
      {label}
    </Button>
  );
};

export default SignInButton;
