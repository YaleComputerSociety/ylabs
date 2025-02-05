import Button from "@mui/material/Button";

const YURAButton = () => {
    return(
        <Button
            component="a"
            href="https://www.yura.yale.edu/"
            target="_blank"
            rel="noopener noreferrer"
        >
            <img src="/assets/logos/YURA.png" alt="yura-logo" style={{width: '90px', height: '20px'}} />
        </Button>
    );
};

export default YURAButton;