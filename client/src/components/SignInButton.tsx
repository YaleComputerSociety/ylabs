import Button from "@mui/material/Button";
import { useEffect, useState } from "react";

const SignInButton = () => {
  const backendBaseURL = window.location.host.includes("yalelabs.io")
    ? "https://yalelabs.io"
    : process.env.REACT_APP_SERVER;
  
  const [redirectUrl, setRedirectUrl] = useState(window.location.origin);
  
  useEffect(() => {
    console.log("SIGNIN: Component mounted, checking for saved path");
    
    // Check if there's a saved return path from logout
    const savedPath = localStorage.getItem('logoutReturnPath');
    console.log("SIGNIN: Found saved path:", savedPath);
    
    if (savedPath) {
      // Make sure the saved path is a valid URL
      try {
        // Parse it to make sure it's valid
        const url = new URL(savedPath);
        console.log("SIGNIN: Valid URL, using for redirect:", savedPath);
        setRedirectUrl(savedPath);
      } catch (error) {
        // If it's not a full URL, try to construct one
        console.log("SIGNIN: Not a valid URL, trying to fix:", savedPath);
        const fixedUrl = window.location.origin + (savedPath.startsWith('/') ? savedPath : '/' + savedPath);
        console.log("SIGNIN: Fixed URL:", fixedUrl);
        setRedirectUrl(fixedUrl);
      }
      
      // Clear it so it's only used once
      localStorage.removeItem('logoutReturnPath');
    }
  }, []);
  
  const finalUrl = backendBaseURL + `/cas?redirect=${redirectUrl}`;
  console.log("SIGNIN: Final redirect URL:", finalUrl);
  
  return (
    <Button
      variant="contained"
      href={finalUrl}
    >
      Sign in With Yale CAS
    </Button>
  );
};

export default SignInButton;
