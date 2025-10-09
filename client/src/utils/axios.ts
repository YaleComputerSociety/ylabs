import axios from "axios";

export const backendBaseURL = window.location.host.includes("yalelabs.io")
    ? "https://yalelabs.io"
    : (import.meta.env.VITE_APP_SERVER || "http://localhost:4000");

export default axios.create({
  withCredentials: true,
  baseURL: backendBaseURL,
});
