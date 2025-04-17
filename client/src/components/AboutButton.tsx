import Button from "@mui/material/Button";
import { Link } from 'react-router-dom';

const AboutButton = () => {
    return(
        <Button 
            color="inherit"
            component={Link}
            to="/about"
            sx={{
                textTransform: 'none',
                color: '#000000',
                fontFamily: 'Inter',
                fontWeight: 450,
                fontSize: '14px'
             }}
        >
            About
        </Button>
    );
};

export default AboutButton;