import Button from "@mui/material/Button";
import { Link } from 'react-router-dom';

const DrawerHomeButton = () => {
    return(
        <Button
            color="inherit"
            component={Link}
            to="/"
            sx={{ paddingLeft: 1 }}
        >
            Find Labs
        </Button>
    );
};

export default DrawerHomeButton;