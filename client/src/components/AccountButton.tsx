import Button from "@mui/material/Button";
import { Link } from 'react-router-dom';

const AccountButton = () => {
    return(
        <Button 
            color="inherit"
            component={Link}
            to="/account"
            sx={{ paddingLeft: 1 }}
        >
            Account
        </Button>
    );
};

export default AccountButton;