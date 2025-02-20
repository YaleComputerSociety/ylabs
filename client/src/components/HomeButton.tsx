import Button from "@mui/material/Button";
import { Link } from 'react-router-dom';

const HomeButton = () => {
    return(
        <Button
            component={Link}
            to="/"
        >
            <img src="/assets/logos/RDB.png" alt="rdb-logo" style={{width: '80px', height: '40px'}} />
        </Button>
    );
};

export default HomeButton;