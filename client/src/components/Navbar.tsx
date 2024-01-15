import styled from "styled-components";
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import RDBLogo from "../assets/RDB.png";
import YURALogo from "../assets/YURA.png";
import SignOutButton from "../components/SignOutButton";
import { useContext } from "react";

import UserContext from "../contexts/UserContext";

export default function Navbar() {
  const { isLoading, isAuthenticated } = useContext(UserContext);

  return (
    <Box sx={{ flexGrow: 1}}>
      <AppBar position="fixed">
        <Toolbar>
          {isAuthenticated ? 
            <img src={RDBLogo} alt="rdb-logo" style={{width: '80px', height: '40px'}} /> : 
            <img src={YURALogo} alt="yura-logo" style={{width: '90px', height: '20px'}}  />
          }
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
          </Typography>
          {isAuthenticated ? <SignOutButton /> : <div />}
        </Toolbar>
      </AppBar>
    </Box>
  );
}