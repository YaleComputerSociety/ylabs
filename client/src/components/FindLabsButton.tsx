import Button from "@mui/material/Button";
import { Link } from 'react-router-dom';

const FindLabsButton = () => {
    return(
        <Button 
            color="inherit"
            component={Link}
            to="/"
            sx={{
                textTransform: 'none',
                color: '#000000',
                fontFamily: 'Inter',
                fontWeight: 450,
                fontSize: '14px'
             }}
             disableRipple={true}
        >
            Find Labs
        </Button>
    );
};

export default FindLabsButton;