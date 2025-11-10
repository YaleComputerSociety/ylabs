import PrivateRoute from "./components/PrivateRoute";
import UnprivateRoute from "./components/UnprivateRoute";
import AdminRoute from "./components/AdminRoute";
import { BrowserRouter as Router, Routes, Route, } from 'react-router-dom'
import Home from "./pages/home";
import Login from "./pages/login";
import About from "./pages/about";
import Account from "./pages/account";
import Unknown from "./pages/unknown";
import LoginError from "./pages/loginError";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import Analytics from "./pages/analytics";

const App = () => {
  return (
    <Router>
      <div className="flex flex-col min-h-screen">
        <Navbar/>
        <main className="flex-grow">
          <Routes>
          <Route path="/" element={<PrivateRoute Component={Home} unknownBlocked={true}/>} />
          <Route path="/about" element={<PrivateRoute Component={About} unknownBlocked={true}/>} />
          <Route path="/account" element={<PrivateRoute Component={Account} unknownBlocked={true}/>} />
          <Route path="/analytics" element={<AdminRoute Component={Analytics}/>} />
          <Route path="/login" element={<Login />} />
          <Route path="/login-error" element={<UnprivateRoute Component={LoginError} />} />
          <Route path="/unknown" element={<PrivateRoute Component={Unknown} knownBlocked={true}/>} />
          <Route path="/*" element={<PrivateRoute Component={Home} unknownBlocked={true}/>} />
          </Routes>
        </main>
        <Footer />
      </div>
  </Router>
  );
};

export default App;