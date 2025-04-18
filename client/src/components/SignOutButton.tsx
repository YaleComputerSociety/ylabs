import Button from "@mui/material/Button";
import { useContext } from "react";

import axios from "../utils/axios";
import UserContext from "../contexts/UserContext";

const SignOutButton = () => {
  const { checkContext } = useContext(UserContext);

  const handleLogout = () => {
    // Save the current path to localStorage
    const currentPath = window.location.pathname;
    
    // Skip saving login page
    if (currentPath !== '/login') {
      // Save the full URL including origin, as that's what the redirect param expects
      const returnUrl = window.location.origin + currentPath;
      localStorage.setItem('logoutReturnPath', returnUrl);
    }
    
    // Perform logout
    axios.get<{ success: boolean }>("/logout").then(({ data }) => {
      if (data.success) {
        checkContext();
      } else {
        console.log('LOGOUT: Logout failed');
      }
    }).catch(error => {
      console.error('LOGOUT: Error during logout:', error);
    });
  };

  return (
    <Button
      color="inherit"
      sx={{
        textTransform: 'none',
        color: '#3874CB',
        fontFamily: 'Inter',
        fontWeight: 450,
        fontSize: '14px',
        textDecoration: 'underline'
      }}
      onClick={handleLogout}
      disableRipple={true}
    >
      Logout
    </Button>
  );
};

export default SignOutButton;
