import Button from "@mui/material/Button";

const YURAButton = () => {
    return(
        <Button
            component="a"
            href="https://www.yura.yale.edu/"
            target="_blank"
            rel="noopener noreferrer"
        >
            <img src="/assets/logos/ylabs-temp.png" alt="ylab-logo" style={{width: '65px', height: '26px'}} />
        </Button>
    );
};

export default YURAButton;