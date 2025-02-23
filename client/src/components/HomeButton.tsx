import Button from "@mui/material/Button";
import { Link } from 'react-router-dom';

const HomeButton = () => {
    return(
        <Button
            component={Link}
            to="/"
        >
            <img src="/assets/logos/ylabs-temp.png" alt="ylabs-logo" style={{width: '65px', height: '26px'}} />
        </Button>
    );
};

export default HomeButton;