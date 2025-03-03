import Button from "@mui/material/Button";
import { useContext } from "react";

import axios from "../utils/axios";
import UserContext from "../contexts/UserContext";

const SignOutButton = () => {
  const { checkContext } = useContext(UserContext);

  return (
    <Button
      color="inherit"
      sx={{ paddingLeft: 1 }}
      onClick={() =>
        axios.get<{ success: boolean }>("/logout").then(({ data }) => {
          if (data.success) {
            checkContext();
          }
        })
      }
    >
      Logout
    </Button>
  );
};

export default SignOutButton;
