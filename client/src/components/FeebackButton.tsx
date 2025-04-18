import Button from "@mui/material/Button";

const FeedbackButton = () => {
    return(
        <Button 
            component={"a"}
            href="https://docs.google.com/forms/d/e/1FAIpQLSf2BE6MBulJHWXhDDp3y4Nixwe6EH0Oo9X1pTo976-KrJKv5g/viewform?usp=dialog"
            target="_blank"
            rel="noopener noreferrer"
            color="inherit"
            sx={{
                textTransform: 'none',
                color: '#000000',
                fontFamily: 'Inter',
                fontWeight: 450,
                fontSize: '14px'
             }}
             disableRipple={true}
        >
            Feedback
        </Button>
    );
};

export default FeedbackButton;