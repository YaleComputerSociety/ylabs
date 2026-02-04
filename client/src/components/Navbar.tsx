import { useState, useContext } from 'react';
import { useLocation } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Collapse from '@mui/material/Collapse';
import useMediaQuery from '@mui/material/useMediaQuery';
import UserButton from "./UserButton";
import SignOutButton from "./SignOutButton";
import AboutButton from "./AboutButton";
import AccountButton from "./AccountButton"
import HomeButton from "./HomeButton";
import DrawerHomeButton from './DrawerHomeButton';
import YURAButton from './YURAButton';
import AnalyticsButton from './AnalyticsButton';
import DatabaseButton from './DatabaseButton';
import UserContext from "../contexts/UserContext";
import FeedbackButton from './FeebackButton';
import NavbarSearchBar from './navbar/NavbarSearchBar';
import NavbarDepartmentFilter from './navbar/NavbarDepartmentFilter';
import NavbarResearchAreaFilter from './navbar/NavbarResearchAreaFilter';
import NavbarListingResearchAreaFilter from './navbar/NavbarListingResearchAreaFilter';
import NavbarSortDropdown from './navbar/NavbarSortDropdown';
import ActiveFiltersBar from './navbar/ActiveFiltersBar';

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
  const isMobile = useMediaQuery(`(max-width:${MOBILE_BREAKPOINT})`);
  const location = useLocation();

  const isAdmin = user?.userType === 'admin';
  const isHomePage = location.pathname === '/';

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
          position="fixed"
          sx={{
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
              zIndex: 1
            }}>
              {isAdmin && <AnalyticsButton />}
              <DatabaseButton />
              <AccountButton />
              <UserButton />
            </Box>
          )}
          <Toolbar sx={{ height: '64px', width: '100%', justifyContent: 'flex-start' }}>
            {isAuthenticated ? <HomeButton /> : <YURAButton />}

            {/* Desktop search controls - only on home page */}
            {isAuthenticated && isHomePage && (
              <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: '12px', ml: 1, maxWidth: '850px', alignItems: 'center' }}>
                <NavbarSearchBar />
                <NavbarDepartmentFilter />
                <NavbarResearchAreaFilter />
                <NavbarListingResearchAreaFilter />
                <NavbarSortDropdown />
              </Box>
            )}

            {isAuthenticated && (
              <>
                {isMobile ? (
                  /* Mobile controls */
                  <Box sx={{ display: 'flex', gap: '8px', alignItems: 'center', ml: 'auto' }}>
                    {/* Search icon on home page */}
                    {isHomePage && (
                      <IconButton
                        size="small"
                        color="inherit"
                        aria-label="search"
                        onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
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
                    {/* Hamburger menu */}
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
                  </Box>
                ) : null}
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
                position: 'fixed',
                top: '64px',
                left: 0,
                right: 0,
                bgcolor: 'white',
                boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.1)',
                p: 2,
                zIndex: 1099,
                display: 'flex',
                flexDirection: 'column',
                gap: 2
              }}
            >
              <NavbarSearchBar />
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <NavbarDepartmentFilter />
                <NavbarResearchAreaFilter />
                <NavbarListingResearchAreaFilter />
              </Box>
            </Box>
          </Collapse>
        )}

        {/* Active filters bar - only on home page */}
        {isAuthenticated && isHomePage && <ActiveFiltersBar />}
      </Box>
    </ThemeProvider>
  );
}