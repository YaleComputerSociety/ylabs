import { Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useContext } from 'react';
import UserContext from '../contexts/UserContext';

export default function ApplicationsButton() {
  const navigate = useNavigate();
  const { user } = useContext(UserContext);

  // Only show for students
  if (!user || !['undergraduate', 'graduate'].includes(user.userType)) {
    return null;
  }

  return (
    <Button
      onClick={() => navigate('/applications')}
      sx={{
        color: 'black',
        textTransform: 'none',
        fontSize: '16px',
        fontWeight: 500,
        padding: '8px 16px',
        borderRadius: '4px',
        '&:hover': {
          backgroundColor: 'rgba(0, 0, 0, 0.04)',
        },
      }}
    >
      Applications
    </Button>
  );
}
