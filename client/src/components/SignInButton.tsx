/**
 * Sign in button redirecting to Yale CAS.
 */
import Button from '@mui/material/Button';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { buildApiUrl } from '../utils/apiBaseUrl';
import { isAsciiControlCode } from '../utils/asciiControl';

const MAX_CAS_RETURN_PATH_LENGTH = 2048;

const normalizeReturnPath = (value?: string | null): string => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CAS_RETURN_PATH_LENGTH) return '';
  if (
    Array.from(trimmed).some((character) => {
      const code = character.charCodeAt(0);
      return isAsciiControlCode(code) || code === 0x20 || character === '\\';
    })
  )
    return '';

  try {
    const url = new URL(trimmed, window.location.origin);
    if (url.origin !== window.location.origin) return '';
    const path = `${url.pathname}${url.search}${url.hash}`;
    if (!path.startsWith('/') || path.startsWith('//')) return '';
    if (/^\/%(?:2f|5c)/i.test(path) || /%(?:0a|0d)/i.test(path)) return '';
    return path;
  } catch {
    return '';
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
