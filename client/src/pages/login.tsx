import PulseLoader from "react-spinners/PulseLoader";
import styled from "styled-components";
import { useContext } from "react";

import SignInButton from "../components/SignInButton";
import UserContext from "../contexts/UserContext";
import { Navigate } from "react-router-dom";

const Login = () => {
  const { isLoading, isAuthenticated, user } = useContext(UserContext);

  // Determine redirect path based on user type
  const getRedirectPath = () => {
    // Professors go to account page
    if (user?.userType === 'professor') {
      return '/account';
    }
    // All other users go to home page
    return '/';
  };

  return (
    <Container>
      <Description>
        <Logo src="/assets/logos/ylabs-temp-blue.png" alt="ylabs-logo" style={{width: '320px', height: '128px'}}/>
        <TitleText className="mt-12">A Yale Research Database</TitleText>
        <Text className="mt-2">
          Search through 1400+ Yale faculty listings across 60+ fields of study. Learn about professors who share your research interests and find potential research mentors.
        </Text>
      </Description>
      <AuthContainer>
        {isLoading ? (
          <PulseLoader color="#66CCFF" size={10} />
        ) : isAuthenticated ? (
          <Navigate to={getRedirectPath()} replace />
        ) : (
          <SignInButton />
        )}
      </AuthContainer>
    </Container>
  );
};

const Container = styled.div`
  width: 100%;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 5% 20px;
  box-sizing: border-box;
`;

const Description = styled.div`
  width: 100%;
  max-width: 600px;
  margin-top: 120px;
  display: flex;
  align-items: center;
  flex-direction: column;
  justify-content: top;
  text-align: center;
  
  @media (max-width: 768px) {
    padding: 0 15px;
  }
`;

const Logo = styled.img`
  width: 320px;
  height: auto;
  max-width: 90%;
  
  @media (max-width: 768px) {
    width: 250px;
  }
  
  @media (max-width: 480px) {
    width: 200px;
  }
`;

const TitleText = styled.h1`
  color: #000000;
  font-size: 32px;
  
  @media (max-width: 768px) {
    font-size: 28px;
    margin-top: 20px !important;
  }
  
  @media (max-width: 480px) {
    font-size: 24px;
  }
`;

const Text = styled.p`
  color: #000000;
  font-size: 20px;
  
  @media (max-width: 768px) {
    font-size: 18px;
  }
  
  @media (max-width: 480px) {
    font-size: 16px;
  }
`;

const AuthContainer = styled.div`
  margin-top: 30px;
  width: 100%;
  max-width: 600px;
  display: flex;
  align-items: center;
  flex-direction: column;
  text-align: center;
  
  @media (max-width: 768px) {
    margin-top: 20px;
  }
`;

export default Login;
