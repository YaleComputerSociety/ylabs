import Button from "@mui/material/Button";
import { Link, useLocation } from 'react-router-dom';

const DatabaseButton = () => {
    const location = useLocation();
    const isActive = location.pathname === '/';

    const handleClick = (event: React.MouseEvent) => {
        if (isActive) {
            event.preventDefault();
        }
    };

    return(
        <Button
            color="inherit"
            component={Link}
            to="/"
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
            Find Labs
        </Button>
    );
};

export default DatabaseButton;
