import Button from "@mui/material/Button";
import { Link, useLocation } from 'react-router-dom';

const HomeButton = () => {
    const location = useLocation();
    
    const handleClick = (event: React.MouseEvent) => {
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
            disableRipple={true}
        >
            <img src="/assets/logos/paperclip.png" alt="ylabs-logo" className="mr-2" style={{width: '31.65px', height: '27px'}} />
            <img src="/assets/logos/ylabs-blue.png" alt="ylabs-logo" style={{width: '65.17px', height: '27px'}} />
        </Button>
    );
};

export default HomeButton;