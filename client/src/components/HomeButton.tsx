/**
 * Logo home button that navigates to a clean research discovery home.
 */
import Button from '@mui/material/Button';
import { Link, useLocation } from 'react-router-dom';
import { navFocusRingSx } from '../utils/focusRing';
import Wordmark from './Wordmark';
import {
  RESEARCH_HOME_PATH,
  isResearchHomeLocation,
  researchHomeResetState,
} from './researchHomeNavigation';

const HomeButton = () => {
  const location = useLocation();
  const alreadyAtResearchHome = isResearchHomeLocation(location);

  return (
    <Button
      component={Link}
      to={RESEARCH_HOME_PATH}
      state={researchHomeResetState()}
      replace={alreadyAtResearchHome}
      disableRipple={true}
      sx={{
        '&:hover': { backgroundColor: 'transparent' },
        textTransform: 'none',
        minWidth: 'auto',
        minHeight: '44px',
        padding: { xs: '6px 10px 6px 0px', sm: '6px 16px 6px 0px' },
        marginLeft: { xs: '-10px', sm: '-16px' },
        ...navFocusRingSx,
      }}
    >
      <img
        src="/brand/yale-research-mark.svg"
        alt=""
        className="mr-2"
        style={{ width: '32px', height: '32px' }}
      />
      <Wordmark className="text-xl text-[var(--yr-blue)] sm:text-[1.35rem]" />
    </Button>
  );
};

export default HomeButton;
