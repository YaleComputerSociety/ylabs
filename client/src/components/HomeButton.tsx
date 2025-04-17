import Button from "@mui/material/Button";
import { Link, useLocation } from 'react-router-dom';

const HomeButton = () => {
    const location = useLocation();
    
    const handleClick = (event: React.MouseEvent) => {
        // If already on the home page, reload the page
        if (location.pathname === '/') {
            event.preventDefault();
            window.location.reload();
        }
    };

    return(
        <Button
            component={Link}
            to="/"
            onClick={handleClick}
        >
            <img src="/assets/logos/ylabs-temp.png" alt="ylabs-logo" style={{width: '65px', height: '26px'}} />
        </Button>
    );
};

export default HomeButton;