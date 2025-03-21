import PulseLoader from "react-spinners/PulseLoader";
import styled from "styled-components";
import { useContext } from "react";

import SignInButton from "../components/SignInButton";
import UserContext from "../contexts/UserContext";
import { Navigate } from "react-router-dom";

const Login = () => {
  const { isLoading, isAuthenticated } = useContext(UserContext);

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
          <Navigate to="/" />
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
