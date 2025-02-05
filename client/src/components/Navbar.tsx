import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import SignOutButton from "./SignOutButton";
import AboutButton from "./AboutButton";
import HomeButton from "./HomeButton";
import YURAButton from './YURAButton';
import { useContext } from "react";

import UserContext from "../contexts/UserContext";

export default function Navbar() {
  const { isAuthenticated } = useContext(UserContext);

  return (
    <Box sx={{ flexGrow: 1}}>
      <AppBar position="fixed">
        <Toolbar>
          {isAuthenticated ? 
            <HomeButton /> : 
            <YURAButton />
          }
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
          </Typography>
          {isAuthenticated ? <AboutButton /> : <div />}
          {isAuthenticated ? <SignOutButton /> : <div />}
        </Toolbar>
      </AppBar>
    </Box>
  );
}