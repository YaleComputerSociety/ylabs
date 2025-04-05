import Button from "@mui/material/Button";
import { useEffect, useState } from "react";

const SignInButton = () => {
  const backendBaseURL = window.location.host.includes("yalelabs.io")
    ? "https://yalelabs.io"
    : process.env.REACT_APP_SERVER;
  
  const [redirectUrl, setRedirectUrl] = useState(window.location.origin);
  
  useEffect(() => {
    // Check if there's a saved return path from logout
    const savedPath = localStorage.getItem('logoutReturnPath');
    if (savedPath) {
      console.log('Found saved return path from logout:', savedPath);
      setRedirectUrl(savedPath);
      // Clear it so it's only used once
      localStorage.removeItem('logoutReturnPath');
    }
  }, []);
  
  return (
    <Button
      variant="contained"
      href={backendBaseURL + `/cas?redirect=${redirectUrl}`}
    >
      Sign in With Yale CAS
    </Button>
  );
};

export default SignInButton;
