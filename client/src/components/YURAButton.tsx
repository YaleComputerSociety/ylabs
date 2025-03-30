import Button from "@mui/material/Button";

const YURAButton = () => {
    const handleReload = () => {
        window.location.reload();
    };

    return(
        <Button
            onClick={handleReload}
        >
            <img src="/assets/logos/ylabs-temp.png" alt="ylab-logo" style={{width: '65px', height: '26px'}} />
        </Button>
    );
};

export default YURAButton;