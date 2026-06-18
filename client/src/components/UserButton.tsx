/**
 * User avatar button in the navigation bar.
 */
import { useState, useContext } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import UserContext from '../contexts/UserContext';
import { buildApiUrl } from '../utils/apiBaseUrl';
import { safeRouteSegment } from '../utils/url';

const MAX_LOGOUT_RETURN_PATH_LENGTH = 2048;

const storeLogoutReturnPath = () => {
  if (window.location.pathname === '/login') return;

  const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  localStorage.removeItem('logoutReturnPath');
  if (returnPath.length <= MAX_LOGOUT_RETURN_PATH_LENGTH) {
    sessionStorage.setItem('logoutReturnPath', returnPath);
  }
};

const UserButton = () => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const location = useLocation();
  const { user } = useContext(UserContext);
  const isProfessorUser = user?.userType === 'professor' || user?.userType === 'faculty';

  const getInitials = () => {
    if (user?.netId && user.netId.length > 0) {
      const first = user.netId.charAt(0).toUpperCase();
      const lettersOnly = user.netId.replace(/[0-9]/g, '');
      const last =
        lettersOnly.length > 0 ? lettersOnly.charAt(lettersOnly.length - 1).toUpperCase() : first;
      return `${first}${last}`;
    }
    return '?';
  };

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = () => {
    handleClose();
    storeLogoutReturnPath();
    window.location.href = buildApiUrl('/logout');
  };

  const handleAboutClick = (event: React.MouseEvent) => {
    if (location.pathname === '/about') {
      event.preventDefault();
    }
    handleClose();
  };

  const isAboutActive = location.pathname === '/about';

  const menuItemStyle = {
    fontFamily: 'Inter',
    fontSize: '14px',
    fontWeight: 450,
    color: '#000000',
    '&:hover': {
      backgroundColor: 'transparent',
      color: '#1876D1',
    },
  };

  return (
    <Box>
      <Button
        aria-label="Open user menu"
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : undefined}
        onClick={handleClick}
        sx={{
          minWidth: '44px',
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          backgroundColor: '#0055A4',
          color: '#FFFFFF',
          fontFamily: 'Inter',
          fontWeight: 600,
          fontSize: '14px',
          padding: 0,
          '&:hover': {
            backgroundColor: '#004B93',
          },
          '&:focus-visible': {
            outline: '2px solid #1876D1',
            outlineOffset: '2px',
          },
        }}
        disableRipple
      >
        {getInitials()}
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        disableScrollLock={true}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        sx={{
          '& .MuiPaper-root': {
            boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.15)',
            borderRadius: '8px',
            minWidth: '120px',
          },
        }}
      >
        {isProfessorUser && (
          <MenuItem
            component={Link}
            to="/account"
            onClick={handleClose}
            sx={menuItemStyle}
            disableRipple
          >
            Edit Profile
          </MenuItem>
        )}
        {isProfessorUser && user?.netId && (
          <MenuItem
            component={Link}
            to={`/profile/${safeRouteSegment(user.netId)}`}
            onClick={handleClose}
            sx={menuItemStyle}
            disableRipple
          >
            Public Profile
          </MenuItem>
        )}
        <MenuItem
          component={Link}
          to="/about"
          onClick={handleAboutClick}
          sx={{
            ...menuItemStyle,
            color: isAboutActive ? '#1876D1' : '#000000',
          }}
          disableRipple
        >
          About
        </MenuItem>
        <MenuItem
          component="a"
          href="https://docs.google.com/forms/d/e/1FAIpQLSf2BE6MBulJHWXhDDp3y4Nixwe6EH0Oo9X1pTo976-KrJKv5g/viewform"
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleClose}
          sx={menuItemStyle}
          disableRipple
        >
          Feedback
        </MenuItem>
        <MenuItem onClick={handleLogout} sx={menuItemStyle} disableRipple>
          Logout
        </MenuItem>
      </Menu>
    </Box>
  );
};

export default UserButton;
