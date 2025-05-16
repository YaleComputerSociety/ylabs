import axios from "axios";

const backendBaseURL = window.location.host.includes("yalelabs.io")
    ? "https://yalelabs.io"
    : import.meta.env.VITE_APP_SERVER;

export default axios.create({
  withCredentials: true,
  baseURL: backendBaseURL,
});
