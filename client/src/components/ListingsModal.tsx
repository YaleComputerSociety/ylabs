import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Modal from '@mui/material/Modal';
import {Listing} from '../types/types';

type ListingModalProps = {
  listing: Listing;
  open: boolean;
  setOpen: (open: boolean) => void;
}

export default function ListingModal(props: ListingModalProps) {
  const { listing, open, setOpen } = props;
  const handleClose = () => setOpen(false);
  const [windowHeight, setWindowHeight] = React.useState(window.innerHeight);

  React.useEffect(() => {
    const handleWindowResize = () => {
      setWindowHeight(window.innerHeight);
    };

    window.addEventListener('resize', handleWindowResize);

    return () => {
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [windowHeight]);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      aria-labelledby="modal-modal-title"
      aria-describedby="modal-modal-description"
      sx={{overflow:'scroll', width: '75%', left: '12.5%', maxHeight:(windowHeight - 200).toString() + 'px', marginTop:'100px' }}
    >
      <Box className="bg-gray-200 shadow-md rounded-lg p-6 w-3/4 mx-auto mt-20">
        <Typography id="modal-modal-title" variant="h6" component="h2">
          Research Posting from {listing.name}
        </Typography>
        <Typography id="modal-modal-description" sx={{ mt: 2 }}>
          <b> Email: </b> {listing.email} <br></br>
          <b> Departments: </b> {listing.departments} <br></br>
          <b> Website: </b> <a target="_blank" rel="noreferrer" href={listing.website}>{listing.website}</a> <br></br>
          <b> Description: </b> {listing.description === '' ? 'None' : listing.description} <br></br>
          <b> Keywords: </b> {listing.keywords === '' ? 'None' : listing.keywords} <br></br>
          <b> Last Updated: </b> {listing.lastUpdated} <br></br>
        </Typography>
      </Box>
    </Modal>
  );
}

const modalStyle = {
  position: 'absolute' as 'absolute',
  bgcolor: 'background.paper',
  border: '2px solid #000',
  boxShadow: 24,
  p: 4,
};