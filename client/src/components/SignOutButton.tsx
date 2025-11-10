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
      const returnUrl = window.location.origin + currentPath;
      localStorage.setItem('logoutReturnPath', returnUrl);
    }
    
    // Redirect to logout endpoint (which will redirect to CAS logout)
    window.location.href = axios.defaults.baseURL + "/logout";
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