/**
 * Main navigation bar with search, filters, and user controls.
 */
import { useState, useContext } from 'react';
import { useLocation, Link } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import useMediaQuery from '@mui/material/useMediaQuery';
import Button from '@mui/material/Button';
import UserButton from './UserButton';
import SignOutButton from './SignOutButton';
import AboutButton from './AboutButton';
import HomeButton from './HomeButton';
import YURAButton from './YURAButton';
import AnalyticsButton from './AnalyticsButton';
import UserContext from '../contexts/UserContext';
import FeedbackButton from './FeedbackButton';
import { isPrimaryNavLinkActive, primaryNavLinks } from './navigationLinks';
import { navFocusRingSx } from '../utils/focusRing';

import { ThemeProvider } from '@mui/material/styles';
import theme from '../utils/muiTheme';

const MOBILE_BREAKPOINT = '768px';

const HamburgerIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="3" y1="12" x2="21" y2="12"></line>
    <line x1="3" y1="6" x2="21" y2="6"></line>
    <line x1="3" y1="18" x2="21" y2="18"></line>
  </svg>
);

const CloseIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

export default function Navbar() {
  const { isAuthenticated, user } = useContext(UserContext);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isMobile = useMediaQuery(`(max-width:${MOBILE_BREAKPOINT})`);
  const location = useLocation();

  const isAdmin = user?.isAdmin ?? false;

  const guestNavLinks = [
    {
      label: 'Yale Research',
      to: '/research',
      active: (pathname: string) => pathname === '/research' || pathname.startsWith('/research/'),
    },
    { label: 'About', to: '/about', active: (pathname: string) => pathname === '/about' },
  ];

  const toggleDrawer = (open: boolean) => (event: React.KeyboardEvent | React.MouseEvent) => {
    if (
      event.type === 'keydown' &&
      ((event as React.KeyboardEvent).key === 'Tab' ||
        (event as React.KeyboardEvent).key === 'Shift')
    ) {
      return;
    }
    setDrawerOpen(open);
  };

  const mobileMenu = () => {
    const listItemStyle = {
      '& .MuiButton-root': {
        paddingLeft: 1,
        justifyContent: 'flex-start',
        minHeight: 44,
        width: '100%',
      },
    };

    return (
      <Box
        sx={{ width: 250 }}
        role="presentation"
        onClick={toggleDrawer(false)}
        onKeyDown={toggleDrawer(false)}
      >
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
          <IconButton
            size="large"
            aria-label="Close menu"
            onClick={(event) => {
              event.stopPropagation();
              setDrawerOpen(false);
            }}
            sx={{
              borderRadius: '4px',
              height: 44,
              width: 44,
              padding: '8px',
              '&:hover': { backgroundColor: 'transparent' },
              ...navFocusRingSx,
            }}
          >
            <CloseIcon />
          </IconButton>
        </Box>
        <List>
          {isAuthenticated ? (
            <>
              {primaryNavLinks.map((link) => {
                const active = isPrimaryNavLinkActive(location.pathname, link);
                return (
                  <ListItem key={link.key} sx={listItemStyle}>
                    <Button
                      component={Link}
                      to={link.to}
                      sx={{
                        textTransform: 'none',
                        color: active ? 'var(--yr-blue)' : 'var(--yr-text)',
                        fontWeight: active ? 600 : 400,
                        justifyContent: 'flex-start',
                        minHeight: 44,
                        width: '100%',
                        pl: 1,
                        ...navFocusRingSx,
                      }}
                    >
                      {link.label}
                    </Button>
                  </ListItem>
                );
              })}
              <ListItem sx={listItemStyle}>
                <AboutButton />
              </ListItem>
              {isAdmin && (
                <ListItem sx={listItemStyle}>
                  <AnalyticsButton />
                </ListItem>
              )}
              <ListItem sx={listItemStyle}>
                <FeedbackButton />
              </ListItem>
              <ListItem sx={listItemStyle}>
                <SignOutButton />
              </ListItem>
            </>
          ) : (
            <>
              {guestNavLinks.map((link) => {
                const active = link.active(location.pathname);
                return (
                  <ListItem key={link.to} sx={listItemStyle}>
                    <Button
                      component={Link}
                      to={link.to}
                      onClick={toggleDrawer(false)}
                      sx={{
                        textTransform: 'none',
                        color: active ? 'var(--yr-blue)' : 'var(--yr-text)',
                        fontWeight: active ? 600 : 400,
                        justifyContent: 'flex-start',
                        minHeight: 44,
                        width: '100%',
                        pl: 1,
                        ...navFocusRingSx,
                      }}
                    >
                      {link.label}
                    </Button>
                  </ListItem>
                );
              })}
              <ListItem sx={listItemStyle}>
                <Button
                  component={Link}
                  to="/login"
                  state={{ from: `${location.pathname}${location.search}` }}
                  onClick={toggleDrawer(false)}
                  sx={{
                    textTransform: 'none',
                    color: 'var(--yr-blue)',
                    fontWeight: 600,
                    justifyContent: 'flex-start',
                    minHeight: 44,
                    width: '100%',
                    pl: 1,
                    ...navFocusRingSx,
                  }}
                >
                  Sign in
                </Button>
              </ListItem>
            </>
          )}
        </List>
      </Box>
    );
  };

  return (
    <ThemeProvider theme={theme}>
      <Box sx={{ flexGrow: 1 }}>
        <AppBar
          position="static"
          sx={{
            position: 'relative',
            background: 'color-mix(in srgb, var(--yr-panel) 96%, var(--yr-page))',
            color: 'var(--yr-ink)',
            height: { xs: '68px', sm: '68px' },
            '& .MuiToolbar-root': {
              minHeight: '68px !important',
              height: '68px !important',
              paddingLeft: { xs: '20px !important', sm: '32px !important' },
              paddingRight: { xs: '16px', lg: '24px' },
              transition: 'padding 0.3s ease',
            },
            boxShadow: '0 1px 0 rgba(11, 31, 58, 0.06)',
            borderBottom: '1px solid var(--yr-line)',
          }}
        >
          <Toolbar sx={{ height: '68px', width: '100%', justifyContent: 'flex-start' }}>
            <Box sx={{ flexShrink: 0 }}>{isAuthenticated ? <HomeButton /> : <YURAButton />}</Box>

            {isAuthenticated && (
              <>
                <Box
                  sx={{
                    display: 'flex',
                    gap: { xs: '8px', lg: '14px' },
                    alignItems: 'center',
                    ml: 'auto',
                    flexShrink: 0,
                  }}
                >
                  {!isMobile && (
                    <>
                      <Box
                        component="nav"
                        aria-label="Primary navigation"
                        sx={{ display: 'flex', gap: 0, alignItems: 'center', flexShrink: 0 }}
                      >
                        {primaryNavLinks.map((link) => {
                          const active = isPrimaryNavLinkActive(location.pathname, link);
                          return (
                            <Button
                              key={link.key}
                              component={Link}
                              to={link.to}
                              disableRipple
                              className={`!normal-case !text-sm !min-w-0 !min-h-[44px] !px-3 !py-0 !inline-flex !items-center !rounded-none !border-b-2 hover:!bg-transparent ${active ? '!font-semibold !text-[var(--yr-blue)] !border-[var(--yr-blue)] hover:!text-[var(--yr-blue)]' : '!font-normal !text-[var(--yr-muted)] !border-transparent hover:!text-[var(--yr-blue)]'}`}
                              sx={{
                                borderRadius: '6px 6px 0 0',
                                transition:
                                  'background-color 150ms ease, color 150ms ease, border-color 150ms ease',
                                '&:hover': {
                                  backgroundColor: 'rgba(24, 74, 155, 0.05) !important',
                                },
                                ...navFocusRingSx,
                              }}
                            >
                              {link.label}
                            </Button>
                          );
                        })}
                      </Box>
                      {isAdmin && <AnalyticsButton />}
                      <UserButton />
                    </>
                  )}
                  {isMobile && (
                    <IconButton
                      size="large"
                      edge="end"
                      color="inherit"
                      aria-label="Open menu"
                      aria-expanded={drawerOpen}
                      aria-controls="primary-mobile-menu"
                      onClick={toggleDrawer(true)}
                      sx={{
                        borderRadius: '4px',
                        height: 44,
                        width: 44,
                        padding: '8px',
                        '&:hover': { backgroundColor: 'transparent' },
                        ...navFocusRingSx,
                      }}
                    >
                      <HamburgerIcon />
                    </IconButton>
                  )}
                </Box>
                <Drawer
                  anchor="right"
                  open={drawerOpen}
                  onClose={toggleDrawer(false)}
                  slotProps={{ paper: { id: 'primary-mobile-menu' } }}
                >
                  {mobileMenu()}
                </Drawer>
              </>
            )}

            {!isAuthenticated && (
              <>
                <Box
                  sx={{
                    display: 'flex',
                    gap: { xs: '8px', lg: '14px' },
                    alignItems: 'center',
                    ml: 'auto',
                    flexShrink: 0,
                  }}
                >
                  {!isMobile && (
                    <>
                      <Box
                        component="nav"
                        aria-label="Primary navigation"
                        sx={{ display: 'flex', gap: 0, alignItems: 'center', flexShrink: 0 }}
                      >
                        {guestNavLinks.map((link) => {
                          const active = link.active(location.pathname);
                          return (
                            <Button
                              key={link.to}
                              component={Link}
                              to={link.to}
                              disableRipple
                              className={`!normal-case !text-sm !min-w-0 !min-h-[44px] !px-3 !py-0 !inline-flex !items-center !rounded-none !border-b-2 hover:!bg-transparent ${active ? '!font-semibold !text-[var(--yr-blue)] !border-[var(--yr-blue)] hover:!text-[var(--yr-blue)]' : '!font-normal !text-[var(--yr-muted)] !border-transparent hover:!text-[var(--yr-blue)]'}`}
                              sx={{
                                borderRadius: '6px 6px 0 0',
                                transition:
                                  'background-color 150ms ease, color 150ms ease, border-color 150ms ease',
                                '&:hover': {
                                  backgroundColor: 'rgba(24, 74, 155, 0.05) !important',
                                },
                                ...navFocusRingSx,
                              }}
                            >
                              {link.label}
                            </Button>
                          );
                        })}
                      </Box>
                      <Button
                        component={Link}
                        to="/login"
                        state={{ from: `${location.pathname}${location.search}` }}
                        disableRipple
                        className="!normal-case !text-sm !min-h-[44px] !px-4 !font-semibold !text-white"
                        sx={{
                          backgroundColor: 'var(--yr-blue)',
                          borderRadius: '6px',
                          '&:hover': { backgroundColor: 'var(--yr-blue)' },
                          ...navFocusRingSx,
                        }}
                      >
                        Sign in
                      </Button>
                    </>
                  )}
                  {isMobile && (
                    <IconButton
                      size="large"
                      edge="end"
                      color="inherit"
                      aria-label="Open menu"
                      aria-expanded={drawerOpen}
                      aria-controls="primary-mobile-menu"
                      onClick={toggleDrawer(true)}
                      sx={{
                        borderRadius: '4px',
                        height: 44,
                        width: 44,
                        padding: '8px',
                        '&:hover': { backgroundColor: 'transparent' },
                        ...navFocusRingSx,
                      }}
                    >
                      <HamburgerIcon />
                    </IconButton>
                  )}
                </Box>
                <Drawer
                  anchor="right"
                  open={drawerOpen}
                  onClose={toggleDrawer(false)}
                  slotProps={{ paper: { id: 'primary-mobile-menu' } }}
                >
                  {mobileMenu()}
                </Drawer>
              </>
            )}
          </Toolbar>
        </AppBar>
      </Box>
    </ThemeProvider>
  );
}
