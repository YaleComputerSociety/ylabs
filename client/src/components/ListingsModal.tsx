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

  return (
    <Modal
      open={open}
      onClose={handleClose}
      aria-labelledby="modal-modal-title"
      aria-describedby="modal-modal-description"
    >
      <Box sx={modalStyle}>
        <Typography id="modal-modal-title" variant="h6" component="h2">
          Research Posting from {listing.name}
        </Typography>
        <Typography id="modal-modal-description" sx={{ mt: 2 }}>
          <b> Email: </b> {listing.email} <br></br>
          <b> Departments: </b> {listing.departments} <br></br>
          <b> Website: </b> <a href={listing.website}>{listing.website}</a> <br></br>
          <b> Description: </b> {listing.description} <br></br>
          <b> Keywords: </b> {listing.keywords} <br></br>
          <b> Last Updated: </b> {listing.lastUpdated} <br></br>
        </Typography>
      </Box>
    </Modal>
  );
}

const modalStyle = {
  position: 'absolute' as 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 400,
  bgcolor: 'background.paper',
  border: '2px solid #000',
  boxShadow: 24,
  p: 4,
};