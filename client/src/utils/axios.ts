import axios from "axios";

export default axios.create({
  withCredentials: true,
  baseURL: "http://localhost:4000",
});
