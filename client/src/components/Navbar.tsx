import { useState, useContext } from 'react';
import { useLocation, Link } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Collapse from '@mui/material/Collapse';
import useMediaQuery from '@mui/material/useMediaQuery';
import Button from '@mui/material/Button';
import UserButton from "./UserButton";
import SignOutButton from "./SignOutButton";
import AboutButton from "./AboutButton";
import AccountButton from "./AccountButton"
import HomeButton from "./HomeButton";
import DrawerHomeButton from './DrawerHomeButton';
import YURAButton from './YURAButton';
import AnalyticsButton from './AnalyticsButton';
import UserContext from "../contexts/UserContext";
import FeedbackButton from './FeebackButton';
import NavbarSearchBar from './navbar/NavbarSearchBar';
import NavbarSortDropdown from './navbar/NavbarSortDropdown';
import NavbarCombinedFilter from './navbar/NavbarCombinedFilter';
import ActiveFiltersBar from './navbar/ActiveFiltersBar';
import NavbarFellowshipSearchBar from './navbar/NavbarFellowshipSearchBar';
import NavbarFellowshipCombinedFilter from './navbar/NavbarFellowshipCombinedFilter';
import NavbarFellowshipSortDropdown from './navbar/NavbarFellowshipSortDropdown';
import ActiveFellowshipFiltersBar from './navbar/ActiveFellowshipFiltersBar';

import { ThemeProvider } from '@mui/material/styles';
import theme from '../utils/muiTheme';

// Configurable breakpoint - change this value as needed
const MOBILE_BREAKPOINT = '768px';

// Custom hamburger icon component
const HamburgerIcon = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '2px' }}>
    <div style={{ width: '18px', height: '2px', backgroundColor: 'black' }}></div>
    <div style={{ width: '18px', height: '2px', backgroundColor: 'black' }}></div>
    <div style={{ width: '18px', height: '2px', backgroundColor: 'black' }}></div>
  </div>
);

// Search icon component
const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21l-4.35-4.35" />
  </svg>
);

export default function Navbar() {
  const { isAuthenticated, user } = useContext(UserContext);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileFellowshipSearchOpen, setMobileFellowshipSearchOpen] = useState(false);
  const isMobile = useMediaQuery(`(max-width:${MOBILE_BREAKPOINT})`);
  // Show fellowship search panel on screens between mobile and xl (1280px)
  const showFellowshipMobilePanel = useMediaQuery('(max-width:1279px)');
  const location = useLocation();

  const isAdmin = user?.userType === 'admin';
  const isHomePage = location.pathname === '/';
  const isFellowshipsPage = location.pathname === '/fellowships';
  const isAccountPage = location.pathname === '/account';

  const toggleDrawer = (open: boolean) => (event: React.KeyboardEvent | React.MouseEvent) => {
    if (
      event.type === 'keydown' &&
      ((event as React.KeyboardEvent).key === 'Tab' || (event as React.KeyboardEvent).key === 'Shift')
    ) {
      return;
    }
    setDrawerOpen(open);
  };

  const mobileMenu = () => {
    const listItemStyle = { 
      "& .MuiButton-root": { 
        paddingLeft: 1, 
        justifyContent: "flex-start", 
        width: "100%" 
      } 
    };
    
    return (
      <Box
        sx={{ width: 250 }}
        role="presentation"
        onClick={toggleDrawer(false)}
        onKeyDown={toggleDrawer(false)}
      >
        <List>
          {isAuthenticated ? (
            <>
              <ListItem sx={listItemStyle}><DrawerHomeButton /></ListItem>
              <ListItem sx={listItemStyle}>
                <Button
                  component={Link}
                  to="/fellowships"
                  sx={{
                    textTransform: 'none',
                    color: isFellowshipsPage ? '#0055A4' : '#333',
                    fontWeight: isFellowshipsPage ? 600 : 400,
                    justifyContent: 'flex-start',
                    width: '100%',
                    pl: 1,
                  }}
                >
                  Find Fellowships
                </Button>
              </ListItem>
              <ListItem sx={listItemStyle}><AccountButton /></ListItem>
              <ListItem sx={listItemStyle}><AboutButton /></ListItem>
              {isAdmin && <ListItem sx={listItemStyle}><AnalyticsButton /></ListItem>}
              <ListItem sx={listItemStyle}><FeedbackButton /></ListItem>
              <ListItem sx={listItemStyle}><SignOutButton /></ListItem>
            </>
          ) : (
            <ListItem sx={listItemStyle}><YURAButton /></ListItem>
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
            background: 'linear-gradient(180deg, #ffffff 0%, #f3f4f6 100%)',
            color: '#000000',
            height: { xs: "64px", sm: "64px" },
            "& .MuiToolbar-root": {
              minHeight: "64px !important",
              height: "64px !important",
              paddingLeft: "32px !important",
              paddingRight: {lg: "85px"},
              transition: "padding 0.3s ease"
            },
            boxShadow: '0px 1px 4px rgba(0, 0, 0, 0.1), 0px 1px 3px rgba(0, 85, 164, 0.06)',
            borderBottom: '1px solid rgba(0, 0, 0, 0.06)'
          }}
        >
          {/* Buttons positioned to hug the right side of the website */}
          {isAuthenticated && !isMobile && (
            <Box sx={{
              position: 'absolute',
              right: '16px',
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
              gap: '14px',
              alignItems: 'center',
              zIndex: 10
            }}>
              <Box sx={{ display: 'flex', gap: 0, alignItems: 'center' }}>
                <Button
                  component={Link}
                  to="/"
                  disableRipple
                  sx={{
                    textTransform: 'none',
                    fontWeight: isHomePage ? 600 : 400,
                    color: isHomePage ? '#0055A4' : '#666',
                    borderBottom: isHomePage ? '2px solid #0055A4' : '2px solid transparent',
                    borderRadius: 0,
                    px: 1.5,
                    py: 0.5,
                    minWidth: 'auto',
                    '&:hover': {
                      backgroundColor: 'transparent',
                      color: '#0055A4',
                    }
                  }}
                >
                  Find Labs
                </Button>
                <Button
                  component={Link}
                  to="/fellowships"
                  disableRipple
                  sx={{
                    textTransform: 'none',
                    fontWeight: isFellowshipsPage ? 600 : 400,
                    color: isFellowshipsPage ? '#0055A4' : '#666',
                    borderBottom: isFellowshipsPage ? '2px solid #0055A4' : '2px solid transparent',
                    borderRadius: 0,
                    px: 1.5,
                    py: 0.5,
                    minWidth: 'auto',
                    '&:hover': {
                      backgroundColor: 'transparent',
                      color: '#0055A4',
                    }
                  }}
                >
                  Find Fellowships
                </Button>
                <Button
                  component={Link}
                  to="/account"
                  disableRipple
                  sx={{
                    textTransform: 'none',
                    fontWeight: isAccountPage ? 600 : 400,
                    color: isAccountPage ? '#0055A4' : '#666',
                    borderBottom: isAccountPage ? '2px solid #0055A4' : '2px solid transparent',
                    borderRadius: 0,
                    px: 1.5,
                    py: 0.5,
                    minWidth: 'auto',
                    '&:hover': {
                      backgroundColor: 'transparent',
                      color: '#0055A4',
                    }
                  }}
                >
                  Dashboard
                </Button>
              </Box>
              <UserButton />
            </Box>
          )}
          <Toolbar sx={{ height: '64px', width: '100%', justifyContent: 'flex-start' }}>
            <Box sx={{ flexShrink: 0 }}>
              {isAuthenticated ? <HomeButton /> : <YURAButton />}
            </Box>

            {/* Desktop search controls - only on home page */}
            {isAuthenticated && isHomePage && (
              <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: '12px', ml: 1, mr: '380px', alignItems: 'center', flexShrink: 1, overflow: 'visible' }}>
                <NavbarSearchBar />
                <NavbarCombinedFilter />
                <NavbarSortDropdown />
              </Box>
            )}

            {/* Desktop fellowship search controls - only on fellowships page */}
            {isAuthenticated && isFellowshipsPage && (
              <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: '10px', ml: 1, mr: '380px', alignItems: 'center', flexShrink: 1, overflow: 'visible' }}>
                <NavbarFellowshipSearchBar />
                <NavbarFellowshipCombinedFilter />
                <NavbarFellowshipSortDropdown />
              </Box>
            )}

            {isAuthenticated && (
              <>
                {/* Mobile controls - hamburger for mobile, search icon for mobile OR fellowship page on smaller screens */}
                <Box sx={{ display: 'flex', gap: '8px', alignItems: 'center', ml: 'auto' }}>
                  {/* Search icon on home page (mobile) or fellowships page (up to xl) */}
                  {((isHomePage && isMobile) || (isFellowshipsPage && showFellowshipMobilePanel)) && (
                    <IconButton
                      size="small"
                      color="inherit"
                      aria-label="search"
                      onClick={() => {
                        if (isHomePage) setMobileSearchOpen(!mobileSearchOpen);
                        if (isFellowshipsPage) setMobileFellowshipSearchOpen(!mobileFellowshipSearchOpen);
                      }}
                      sx={{
                        borderRadius: '4px',
                        padding: '8px',
                        '&:hover': {
                          backgroundColor: 'transparent',
                        }
                      }}
                    >
                      <SearchIcon />
                    </IconButton>
                  )}
                  {/* Hamburger menu - only on mobile */}
                  {isMobile && (
                    <IconButton
                      size="large"
                      edge="end"
                      color="inherit"
                      aria-label="menu"
                      onClick={toggleDrawer(true)}
                      sx={{
                        borderRadius: '4px',
                        padding: '8px',
                        '&:hover': {
                          backgroundColor: 'transparent',
                        }
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
                >
                  {mobileMenu()}
                </Drawer>
              </>
            )}
          </Toolbar>
        </AppBar>

        {/* Mobile search panel */}
        {isAuthenticated && isHomePage && isMobile && (
          <Collapse in={mobileSearchOpen}>
            <Box
              sx={{
                bgcolor: 'white',
                boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.1)',
                p: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 2
              }}
            >
              <NavbarSearchBar />
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <NavbarCombinedFilter />
                <NavbarSortDropdown />
              </Box>
            </Box>
          </Collapse>
        )}

        {/* Mobile fellowship search panel - shows on screens smaller than xl */}
        {isAuthenticated && isFellowshipsPage && showFellowshipMobilePanel && (
          <Collapse in={mobileFellowshipSearchOpen}>
            <Box
              sx={{
                bgcolor: 'white',
                boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.1)',
                p: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 2
              }}
            >
              <NavbarFellowshipSearchBar />
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <NavbarFellowshipCombinedFilter />
                <NavbarFellowshipSortDropdown />
              </Box>
            </Box>
          </Collapse>
        )}

        {/* Active filters bar - only on home page */}
        {isAuthenticated && isHomePage && <ActiveFiltersBar />}

        {/* Active fellowship filters bar - only on fellowships page */}
        {isAuthenticated && isFellowshipsPage && <ActiveFellowshipFiltersBar />}
      </Box>
    </ThemeProvider>
  );
}