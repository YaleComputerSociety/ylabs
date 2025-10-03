import { useState } from 'react';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import useMediaQuery from '@mui/material/useMediaQuery';
import SignOutButton from "./SignOutButton";
import AboutButton from "./AboutButton";
import AccountButton from "./AccountButton"
import HomeButton from "./HomeButton";
import DrawerHomeButton from './DrawerHomeButton';
import FindLabsButton from './FindLabsButton';
import YURAButton from './YURAButton';
import { useContext } from "react";
import UserContext from "../contexts/UserContext";
import FeedbackButton from './FeebackButton';

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

export default function Navbar() {
  const { isAuthenticated } = useContext(UserContext);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isMobile = useMediaQuery(`(max-width:${MOBILE_BREAKPOINT})`);

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
            backgroundColor: '#f89d00ff',
            height: { xs: "64px", sm: "64px" },
            "& .MuiToolbar-root": {
              minHeight: "64px !important",
              height: "64px !important",
              paddingLeft: {lg: "85px"},
              paddingRight: {lg: "85px"},
              transition: "padding 0.3s ease"
            },
            boxShadow: '0px 1px 5px rgba(0, 0, 0, 0.2)'
          }}
        >
          <Toolbar sx={{ height: '64px' }}>
            {isAuthenticated ? <HomeButton /> : <YURAButton />}
            <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}></Typography>
            
            {isAuthenticated && (
              <>
                {/* Individual buttons - visible only on larger screens */}
                <Box sx={{ 
                  display: { xs: 'none', md: 'flex' },
                  gap: '14px'
                }}>
                  <AccountButton />
                  <AboutButton />
                  <SignOutButton />
                </Box>
                
                {/* Hamburger menu - visible on all screen sizes */}
                <IconButton
                  size="large"
                  edge="start"
                  color="inherit"
                  aria-label="menu"
                  onClick={toggleDrawer(true)}
                  sx={{ 
                    marginLeft: '18px',
                    borderRadius: '4px',
                    padding: '8px',
                    '&:hover': {
                      backgroundColor: 'rgba(0, 0, 0, 0.04)',
                      borderRadius: '4px'
                    }
                  }}
                >
                  <HamburgerIcon />
                </IconButton>
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
      </Box>
    </ThemeProvider>
  );
}