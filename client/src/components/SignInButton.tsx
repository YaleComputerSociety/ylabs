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
  const [redirectParam, setRedirectParam] = useState('');
  const location = useLocation();
  const locationState = location.state as { from?: string } | null;

  useEffect(() => {
    const savedPath = sessionStorage.getItem('logoutReturnPath');
    const returnPath = normalizeReturnPath(savedPath || locationState?.from);

    setRedirectParam(returnPath ? `?redirect=${encodeURIComponent(returnPath)}` : '');

    if (savedPath) sessionStorage.removeItem('logoutReturnPath');
    localStorage.removeItem('logoutReturnPath');
  }, [locationState?.from]);

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
