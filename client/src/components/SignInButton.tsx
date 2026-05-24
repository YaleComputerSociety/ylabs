/**
 * Sign in button redirecting to Yale CAS.
 */
import Button from '@mui/material/Button';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { buildApiUrl } from '../utils/apiBaseUrl';

const normalizeReturnUrl = (value?: string | null): string => {
  if (!value) return '';

  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return window.location.origin;
    return url.toString();
  } catch {
    return window.location.origin;
  }
};

interface SignInButtonProps {
  label?: string;
}

const SignInButton = ({ label = 'Sign in with Yale CAS' }: SignInButtonProps) => {
  const [redirectParam, setRedirectParam] = useState('');
  const location = useLocation();
  const locationState = location.state as { from?: string } | null;

  useEffect(() => {
    const savedPath = localStorage.getItem('logoutReturnPath');
    const returnUrl = normalizeReturnUrl(savedPath || locationState?.from);

    if (returnUrl) {
      setRedirectParam(`?redirect=${encodeURIComponent(returnUrl)}`);
    }

    if (savedPath) localStorage.removeItem('logoutReturnPath');
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
          backgroundColor: '#0f3473',
          boxShadow: 'none',
        },
        '&:focus-visible': {
          outline: '2px solid rgba(24, 74, 155, 0.35)',
          outlineOffset: '2px',
        },
      }}
    >
      {label}
    </Button>
  );
};

export default SignInButton;
