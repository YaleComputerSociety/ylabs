import { FC, useCallback, useEffect, useState } from "react";
import swal from "sweetalert";

import axios from "../utils/axios";
import UserContext from "../contexts/UserContext";
import { User } from "../types";

const UserContextProvider: FC = ({ children }) => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [user, setUser] = useState<User>();

  const checkContext = useCallback(() => {
    axios
      .get<{ auth: boolean; user?: User }>("/check")
      .then(({ data }) => {
        if (data.auth) {
          setIsAuthenticated(true);
          setUser(data.user);
        } else {
          setIsAuthenticated(false);
          setUser(undefined);
        }
      })
      .catch(() =>
        swal({
          text: "Something went wrong while trying to fetch your auth status.",
          icon: "warning",
        })
      );
    setIsLoading(false);
  }, []);

  useEffect(() => {
    checkContext();
  }, [checkContext]);

  return (
    <UserContext.Provider
      value={{ isLoading, isAuthenticated, user, checkContext }}
    >
      {children}
    </UserContext.Provider>
  );
};

export default UserContextProvider;
