import PrivateRoute from "./components/PrivateRoute";
import { BrowserRouter as Router, Routes, Route, } from 'react-router-dom'
import Home from "./pages/home";
import Login from "./pages/login";
import Navbar from "./components/Navbar";

const App = () => {
  return (
    <Router>
      <Navbar/>
      <Routes>
          <Route path="/" element={<PrivateRoute Component={Home} />} />
          <Route path="/login" element={<Login />} />
      </Routes>
  </Router>
  );
};

export default App;