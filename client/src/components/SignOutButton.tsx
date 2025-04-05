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
      console.log('Saving path before logout:', currentPath);
      
      // Save the full URL including origin, as that's what the redirect param expects
      const returnUrl = window.location.origin + currentPath;
      localStorage.setItem('logoutReturnPath', returnUrl);
    }
    
    // Perform logout
    axios.get<{ success: boolean }>("/logout").then(({ data }) => {
      if (data.success) {
        checkContext();
      }
    });
  };

  return (
    <Button
      color="inherit"
      sx={{ paddingLeft: 1 }}
      onClick={handleLogout}
    >
      Logout
    </Button>
  );
};

export default SignOutButton;
