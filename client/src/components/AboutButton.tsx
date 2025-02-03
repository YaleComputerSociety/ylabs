import Button from "@mui/material/Button";
import { Link } from 'react-router-dom';

const AboutButton = () => {
    return(
        <Button 
            color="inherit"
            component={Link}
            to="/about"
            sx={{ paddingLeft: 1 }}
        >
            About
        </Button>
    );
};

export default AboutButton;