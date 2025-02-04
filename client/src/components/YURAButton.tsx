import Button from "@mui/material/Button";
import { Link } from 'react-router-dom';
import YURALogo from "../assets/YURA.png";

const YURAButton = () => {
    return(
        <Button
            component="a"
            href="https://www.yura.yale.edu/"
            target="_blank"
            rel="noopener noreferrer"
        >
            <img src={YURALogo} alt="yura-logo" style={{width: '90px', height: '20px'}} />
        </Button>
    );
};

export default YURAButton;