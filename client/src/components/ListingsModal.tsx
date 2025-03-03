import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Modal from '@mui/material/Modal';
import { Listing } from '../types/types';

type ListingModalProps = {
  listing: Listing;
  open: boolean;
  setOpen: (open: boolean) => void;
};

export default function ListingModal(props: ListingModalProps) {
  const { listing, open, setOpen } = props;
  const handleClose = () => setOpen(false);
  const [windowHeight, setWindowHeight] = React.useState(window.innerHeight);

  React.useEffect(() => {
    const handleWindowResize = () => {
      setWindowHeight(window.innerHeight);
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      disableAutoFocus
      disableEnforceFocus
      aria-labelledby="modal-modal-title"
      aria-describedby="modal-modal-description"
      sx={{
        overflow: 'scroll',
        width: '75%',
        left: '12.5%',
        maxHeight: (windowHeight - 200).toString() + 'px',
        marginTop: '100px',
      }}
    >
      <Box className="bg-gray-200 shadow-md rounded-lg p-6 w-3/4 mx-auto mt-20">
        <Typography id="modal-modal-title" variant="h5" component="h2">
           {listing.name}
        </Typography>

        {/* Email Block */}
        <Box className="my-2 p-2 bg-white rounded shadow">
          <Typography variant="body1">
            <b>Email:</b>{' '}
            <a 
              href={`mailto:${listing.email}`} 
              className="text-blue-600 underline"
            >
              {listing.email}
            </a>
          </Typography>
        </Box>


        {/* Departments Block */}
        <Box className="my-2 p-2 bg-white rounded shadow">
          <Typography variant="body1">
            <b>Departments:</b>
          </Typography>
          <Box className="flex flex-wrap gap-2 mt-1">
            {listing.departments
              .split(/[;,]+/)           // Split on commas or semicolons
              .map((dept, index) => {
                const trimmedDept = dept.trim();
                return trimmedDept ? (
                  <Box
                    key={index}
                    className="px-3 py-1 bg-blue-200 rounded-full"
                  >
                    {trimmedDept}
                  </Box>
                ) : null;
              })}
          </Box>
        </Box>

        {/* Website Block */}
        <Box className="my-2 p-2 bg-white rounded shadow">
          <Typography variant="body1">
            <b>Website:</b>{' '}
            <a
              href={listing.website}
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 underline"
            >
              {listing.website}
            </a>
          </Typography>
        </Box>

        {/* Description Block */}
        <Box className="my-2 p-2 bg-white rounded shadow">
          <Typography variant="body1">
            <b>Description:</b>{' '}
            {listing.description === '' ? 'None' : listing.description}
          </Typography>
        </Box>

        {/* Keywords Block (only rendered if keywords are provided) */}
        {listing.keywords !== '' && (
          <Box className="my-2 p-2 bg-white rounded shadow">
            <Typography variant="body1">
              <b>Keywords:</b> {listing.keywords}
            </Typography>
          </Box>
        )}

        {/* Last Updated Block */}
        <Box className="my-2 p-2 bg-white rounded shadow">
          <Typography variant="body1">
            <b>Last Updated:</b> {listing.lastUpdated}
          </Typography>
        </Box>
      </Box>
    </Modal>
  );
}
