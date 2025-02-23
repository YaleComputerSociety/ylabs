import PrivateRoute from "./components/PrivateRoute";
import { BrowserRouter as Router, Routes, Route, } from 'react-router-dom'
import Home from "./pages/home";
import Login from "./pages/login";
import About from "./pages/about";
import Account from "./pages/account";
import Navbar from "./components/Navbar";

const App = () => {
  return (
    <Router>
      <Navbar/>
      <Routes>
          <Route path="/" element={<PrivateRoute Component={Home} />} />
          <Route path="/about" element={<PrivateRoute Component={About} />} />
          <Route path="/login" element={<Login />} />
          <Route path="/account" element={<Account />} />
      </Routes>
  </Router>
  );
};

export default App;