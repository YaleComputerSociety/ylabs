/**
 * Logo button for unauthenticated users that reloads the page on click.
 */
import Button from '@mui/material/Button';

const YURAButton = () => {
  const handleReload = () => {
    window.location.reload();
  };

  return (
    <Button
      onClick={handleReload}
      disableRipple={true}
      sx={{ textTransform: 'none', minHeight: '44px' }}
    >
      <img
        src="/assets/logos/paperclip.png"
        alt=""
        className="mr-2"
        style={{ width: '31.65px', height: '27px' }}
      />
      <span className="text-xl font-semibold tracking-normal text-blue-700">
        Yale Research
      </span>
    </Button>
  );
};

export default YURAButton;
