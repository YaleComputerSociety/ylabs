import PulseLoader from "react-spinners/PulseLoader";
import styled from "styled-components";
import { useContext } from "react";

import SignInButton from "./components/SignInButton";
import SignOutButton from "./components/SignOutButton";
import RDBLogo from "./assets/logo.png";
import UserContext from "./contexts/UserContext";
import PrivateRoute from "./components/PrivateRoute";
import { BrowserRouter as Router, Routes, Route, } from 'react-router-dom'
import Home from "./pages/home";
import Login from "./pages/login";

const App = () => {
  const { isLoading, isAuthenticated } = useContext(UserContext);

  return (
    <Router>
      <Routes>
          <Route path="/" element={<PrivateRoute Component={Home} />} />
          <Route path="/login" element={<Login />} />
      </Routes>
  </Router>
  );
};

export default App;