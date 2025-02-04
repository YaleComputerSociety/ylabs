import Button from "@mui/material/Button";
import { Link } from 'react-router-dom';
import RDBLogo from "../assets/RDB.png";

const HomeButton = () => {
    return(
        <Button
            component={Link}
            to="/"
        >
            <img src={RDBLogo} alt="rdb-logo" style={{width: '80px', height: '40px'}} />
        </Button>
    );
};

export default HomeButton;