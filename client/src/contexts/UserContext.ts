import { createContext } from "react";

import { User } from "../types";

export const defaultUserContext = {
  isLoading: true,
  isAuthenticated: false,
  checkContext: () => {},
};

export default createContext<{
  isLoading: boolean;
  isAuthenticated: boolean;
  user?: User;
  checkContext: () => void;
}>(defaultUserContext);
