import Button from "@mui/material/Button";
import { useEffect, useState } from "react";

const SignInButton = () => {
  const backendBaseURL = window.location.host.includes("yalelabs.io")
    ? "https://yalelabs.io"
    : import.meta.env.VITE_APP_SERVER;
  
  const [redirectUrl, setRedirectUrl] = useState(window.location.origin);
  
  useEffect(() => {
    // Check if there's a saved return path from logout
    const savedPath = localStorage.getItem('logoutReturnPath');
    
    if (savedPath) {
      // Make sure the saved path is a valid URL
      try {
        // Parse it to make sure it's valid
        const url = new URL(savedPath);
        setRedirectUrl(savedPath);
      } catch (error) {
        // If it's not a full URL, try to construct one
        const fixedUrl = window.location.origin + (savedPath.startsWith('/') ? savedPath : '/' + savedPath);
        setRedirectUrl(fixedUrl);
      }
      
      // Clear it so it's only used once
      localStorage.removeItem('logoutReturnPath');
    }
  }, []);
  
  const finalUrl = backendBaseURL + `/api/cas?redirect=${redirectUrl}&error=${window.location.origin}/login-error`;
  console.log('Sign-in redirect URL:', finalUrl);
  
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
