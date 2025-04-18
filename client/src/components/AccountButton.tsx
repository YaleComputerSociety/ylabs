import Button from "@mui/material/Button";
import { Link } from 'react-router-dom';

const AccountButton = () => {
    return(
        <Button 
            color="inherit"
            component={Link}
            to="/account"
            sx={{
                textTransform: 'none',
                color: '#000000',
                fontFamily: 'Inter',
                fontWeight: 450,
                fontSize: '14px'
             }}
             disableRipple={true}
        >
            My Labs
        </Button>
    );
};

export default AccountButton;