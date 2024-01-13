import Button from "@mui/material/Button";

const SignInButton = () => (
  <Button
    variant="contained"
    href={`http://localhost:4000/cas?redirect=${window.location.origin}`}
  >
    Sign in With Yale CAS
  </Button>
);

export default SignInButton;
