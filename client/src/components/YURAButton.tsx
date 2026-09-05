/**
 * Logo button for unauthenticated visitors, targeting the public research home.
 */
import Button from '@mui/material/Button';
import { Link, useLocation } from 'react-router-dom';
import { navFocusRingSx } from '../utils/focusRing';
import {
  RESEARCH_HOME_PATH,
  isResearchHomeLocation,
  researchHomeResetState,
} from './researchHomeNavigation';

const YURAButton = () => {
  const location = useLocation();

  return (
    <Button
      component={Link}
      to={RESEARCH_HOME_PATH}
      state={researchHomeResetState(location)}
      replace={isResearchHomeLocation(location)}
      disableRipple={true}
      sx={{ textTransform: 'none', minHeight: '44px', ...navFocusRingSx }}
    >
      <img
        src="/brand/yale-research-mark.svg"
        alt=""
        className="mr-2"
        style={{ width: '32px', height: '32px' }}
      />
      <span className="yr-wordmark text-xl text-[var(--yr-blue)]">Yale Research</span>
    </Button>
  );
};

export default YURAButton;
