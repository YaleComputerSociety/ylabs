import Button from "@mui/material/Button";

const YURAButton = () => {
    const handleReload = () => {
        window.location.reload();
    };

    return(
        <Button
            onClick={handleReload}
            disableRipple={true}
        >
            <img src="/assets/logos/paperclip.png" alt="ylabs-logo" className="mr-2" style={{width: '31.65px', height: '27px'}} />
            <img src="/assets/logos/ylabs-blue.png" alt="ylabs-logo" style={{width: '65.17px', height: '27px'}} />
        </Button>
    );
};

export default YURAButton;