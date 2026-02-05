import Button from "@mui/material/Button";
import { Link, useLocation } from 'react-router-dom';

const AccountButton = () => {
    const location = useLocation();
    const isActive = location.pathname === '/account';

    const handleClick = (event: React.MouseEvent) => {
        if (isActive) {
            event.preventDefault();
        }
    };

    return(
        <Button
            color="inherit"
            component={Link}
            to="/account"
            onClick={handleClick}
            sx={{
                textTransform: 'none',
                color: isActive ? '#1876D1' : '#000000',
                fontFamily: 'Inter',
                fontWeight: 450,
                fontSize: '14px',
                '&:hover': {
                    backgroundColor: 'transparent',
                    color: '#1876D1'
                }
             }}
             disableRipple={true}
        >
            Dashboard
        </Button>
    );
};

export default AccountButton;