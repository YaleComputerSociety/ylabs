import Button from "@mui/material/Button";
import { Link } from 'react-router-dom';

export default function AnalyticsButton() {
  return (
    <Button
      color="inherit"
      component={Link}
      to="/analytics"
      sx={{
        textTransform: 'none',
        color: '#000000',
        fontFamily: 'Inter',
        fontWeight: 450,
        fontSize: '14px'
      }}
      disableRipple={true}
    >
      Analytics
    </Button>
  );
}