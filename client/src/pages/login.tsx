import PulseLoader from "react-spinners/PulseLoader";
import styled from "styled-components";
import { useContext, useEffect, useState } from "react";

import SignInButton from "../components/SignInButton";
import UserContext from "../contexts/UserContext";
import { Navigate, useLocation } from "react-router-dom";

const Login = () => {
  const { isLoading, isAuthenticated, user } = useContext(UserContext);
  const [initialLogin, setInitialLogin] = useState(true);
  const location = useLocation();

  // Reset initial login state when the component mounts
  useEffect(() => {
    setInitialLogin(true);
  }, []);

  // Determine redirect path based on user type and whether it's an initial login
  const getRedirectPath = () => {
    if (initialLogin && user?.userType === 'professor') {
      return '/account';
    }
    // If there's a stored path from before login, use that
    const storedPath = sessionStorage.getItem('lastPath');
    if (storedPath && storedPath !== '/login') {
      sessionStorage.removeItem('lastPath');
      return storedPath;
    }
    return '/';
  };

  // Store the current path when not authenticated
  useEffect(() => {
    if (!isAuthenticated && location.pathname !== '/login') {
      sessionStorage.setItem('lastPath', location.pathname);
    }
  }, [isAuthenticated, location]);

  return (
    <Container>
      <Description>
        <Logo src="/assets/logos/RDB.png" alt="rdb-logo" />
        <TitleText>Yale Research Database</TitleText>
        <Text>
          Search through 1400+ Yale faculty listings across 60+ fields of study. Learn about professors who share your research interests and find potential research mentors.
        </Text>
      </Description>
      <AuthContainer>
        {isLoading ? (
          <PulseLoader color="#66CCFF" size={10} />
        ) : isAuthenticated ? (
          <Navigate to={getRedirectPath()} replace />
        ) : (
          <>
            <SignInButton />
          </>
        )}
      </AuthContainer>
    </Container>
  );
};

const Container = styled.div`
  width: 100vw;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 5%;
`;

const Description = styled.div`
  width: 600px;
  margin-top: 100px;
  display: flex;
  align-items: center;
  flex-direction: column;
  justify-content: top;
  text-align: center;
`;

const Logo = styled.img`
  width: 320px;
  height: 150px;
`;

const TitleText = styled.h1`
  color: #000000;
`;

const Text = styled.p`
  color: #000000;
  font-size: 20px;
`;

const AuthContainer = styled.div`
  margin-top: 30px;
  width: 600px;
  align-items: center;
  flex-direction: column;
  text-align: center;
`;

export default Login;
