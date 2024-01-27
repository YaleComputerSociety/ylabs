import Button from "@mui/material/Button";

const SignInButton = () => (
  <Button
    variant="contained"
    href={process.env.REACT_APP_SERVER + `/cas?redirect=${window.location.origin}`}
  >
    Sign in With Yale CAS
  </Button>
);

export default SignInButton;
