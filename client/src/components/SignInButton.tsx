import Button from "@mui/material/Button";

const SignInButton = () => {
  const backendBaseURL = window.location.host.includes("yalelabs.io")
    ? "https://yalelabs.io"
    : process.env.REACT_APP_SERVER;
  
  return (
    <Button
      variant="contained"
      href={`${backendBaseURL}/cas?redirect=${window.location.origin}`}
    >
      Sign in With Yale CAS
    </Button>
  );
};

export default SignInButton;
