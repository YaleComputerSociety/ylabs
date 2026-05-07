/**
 * Login page with Yale CAS authentication redirect.
 */
import PulseLoader from 'react-spinners/PulseLoader';
import styled from 'styled-components';
import { useContext } from 'react';

import SignInButton from '../components/SignInButton';
import UserContext from '../contexts/UserContext';
import { Navigate } from 'react-router-dom';

const Login = () => {
  const { isLoading, isAuthenticated, user } = useContext(UserContext);

  const getRedirectPath = () => {
    if (user?.userType === 'professor') {
      return '/account';
    }
    return '/';
  };

  return (
    <Container>
      <Description>
        <div className="flex items-center">
          <img
            src="/assets/logos/paperclip.png"
            alt="ylabs-logo"
            className="mr-2 w-[3.5rem] h-[3rem] md:w-[6.33rem] md:h-[5.4rem] sm:w-[4.5rem] sm:h-[4rem] "
          />
          <img
            src="/assets/logos/ylabs-blue.png"
            alt="ylabs-logo"
            className="w-[7rem] h-[3rem] md:w-[13.03rem] md:h-[5.4rem] sm:w-[9rem] sm:h-[4rem]"
          />
        </div>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 mt-5 md:mt-12">
          A Yale Research Database
        </h1>
        <p className="text-base sm:text-lg md:text-xl text-gray-700 mt-2">
          Search through 1400+ Yale faculty listings across 60+ fields of study. Learn about
          professors who share your research interests and find potential research mentors.
        </p>
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
  margin-top: 60px;
  display: flex;
  align-items: center;
  flex-direction: column;
  justify-content: top;
  text-align: center;

  @media (max-width: 768px) {
    padding: 0 15px;
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
