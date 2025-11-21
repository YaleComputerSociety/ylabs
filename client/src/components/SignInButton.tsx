import Button from "@mui/material/Button";
import { useEffect, useState } from "react";

const SignInButton = () => {
  const backendBaseURL = window.location.host.includes("yalelabs.io")
    ? "https://yalelabs.io"
    : import.meta.env.VITE_APP_SERVER;
  
  const [redirectParam, setRedirectParam] = useState('');
  
  useEffect(() => {
    // Check if there's a saved return path from logout
    const savedPath = localStorage.getItem('logoutReturnPath');
    
    if (savedPath) {
      try {
        const url = new URL(savedPath);
        setRedirectParam(`?redirect=${encodeURIComponent(savedPath)}`);
      } catch (error) {
        const fixedUrl = window.location.origin + (savedPath.startsWith('/') ? savedPath : '/' + savedPath);
        setRedirectParam(`?redirect=${encodeURIComponent(fixedUrl)}`);
      }
      
      localStorage.removeItem('logoutReturnPath');
    }
  }, []);

  const finalUrl = `${backendBaseURL}/api/cas${redirectParam}`;
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