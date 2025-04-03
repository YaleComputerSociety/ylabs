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
import YURAButton from './YURAButton';
import { useContext } from "react";
import UserContext from "../contexts/UserContext";
import FeedbackButton from './FeebackButton';

// Configurable breakpoint - change this value as needed
const MOBILE_BREAKPOINT = '768px';

// Custom hamburger icon component
const HamburgerIcon = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', padding: '2px' }}>
    <div style={{ width: '22px', height: '2px', backgroundColor: 'white' }}></div>
    <div style={{ width: '22px', height: '2px', backgroundColor: 'white' }}></div>
    <div style={{ width: '22px', height: '2px', backgroundColor: 'white' }}></div>
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

  const mobileMenu = () => (
    <Box
      sx={{ width: 250 }}
      role="presentation"
      onClick={toggleDrawer(false)}
      onKeyDown={toggleDrawer(false)}
    >
      <List>
        {isAuthenticated ? (
          <>
            <ListItem>
              <DrawerHomeButton />
            </ListItem>
            <ListItem>
              <AccountButton />
            </ListItem>
            <ListItem>
              <AboutButton />
            </ListItem>
            <ListItem>
              <FeedbackButton />
            </ListItem>
            <ListItem>
              <SignOutButton />
            </ListItem>
          </>
        ) : (
          <ListItem>
            <YURAButton />
          </ListItem>
        )}
      </List>
    </Box>
  );

  return (
    <Box sx={{ flexGrow: 1 }}>
      <AppBar 
        position="fixed"
        sx={{ 
          height: { xs: "64px", sm: "64px" },
          "& .MuiToolbar-root": {
            minHeight: "64px !important",
            height: "64px !important",
            paddingLeft: { xs: "20px", sm: "20px" },
            paddingRight: { xs: "20px", sm: "20px" }
          }
        }}
      >
        <Toolbar sx={{ height: '64px' }}>
          {isMobile ? (
            <>
              {isAuthenticated ? <HomeButton /> : <YURAButton />}
              <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}></Typography>
              {isAuthenticated && (
                <>
                  <IconButton
                  size="large"
                  edge="start"
                  color="inherit"
                  aria-label="menu"
                  onClick={toggleDrawer(true)}
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
            </>
          ) : (
            <>
              {isAuthenticated ? <HomeButton /> : <YURAButton />}
              <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}></Typography>
              {isAuthenticated && (
                <>
                  <AboutButton />
                  <FeedbackButton />
                  <AccountButton />
                  <SignOutButton />
                </>
              )}
            </>
          )}
        </Toolbar>
      </AppBar>
    </Box>
  );
}