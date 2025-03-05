import axios from "axios";

const backendBaseURL = window.location.host.includes("yalelabs.io")
    ? "https://yalelabs.io"
    : process.env.REACT_APP_SERVER;

export default axios.create({
  withCredentials: true,
  baseURL: backendBaseURL,
});
