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
        src="/brand/yale-research-mark.svg"
        alt=""
        className="mr-2"
        style={{ width: '32px', height: '32px' }}
      />
      <span className="yr-wordmark text-xl text-[var(--yr-blue)]">
        Yale Research
      </span>
    </Button>
  );
};

export default YURAButton;
