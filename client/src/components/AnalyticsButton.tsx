import { Button } from "@mui/material";
import { useNavigate } from "react-router-dom";

export default function AnalyticsButton() {
  const navigate = useNavigate();

  return (
    <Button
      variant="contained"
      onClick={() => navigate("/analytics")}
      sx={{
        backgroundColor: "#1565c0",
        color: "white",
        textTransform: "none",
        fontWeight: 500,
        fontSize: "15px",
        height: "40px",
        "&:hover": {
          backgroundColor: "#0d47a1",
        },
      }}
    >
      Analytics
    </Button>
  );
}