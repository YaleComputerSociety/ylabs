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
          <Route path="/account" element={<PrivateRoute Component={Account} />} />
          <Route path="/login" element={<Login />} />
      </Routes>
  </Router>
  );
};

export default App;