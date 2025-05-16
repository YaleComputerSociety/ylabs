import React from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import App from "./App";
import reportWebVitals from "./reportWebVitals";
import UserContextProvider from "./providers/UserContextProvider";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root container missing in index.html");
}

const root = createRoot(container);

root.render(
  <React.StrictMode>
    <UserContextProvider>
      <App />
    </UserContextProvider>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
