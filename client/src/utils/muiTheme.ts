/**
 * Material-UI theme configuration.
 */
import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    primary: {
      main: '#00356B',
      dark: '#0B1F3A',
      light: '#E6EDF5',
    },
    secondary: {
      main: '#B89B5E',
      light: '#F4EDDC',
      dark: '#5D4722',
    },
    background: {
      default: '#F8F5ED',
      paper: '#FFFDF8',
    },
    text: {
      primary: '#0B1F3A',
      secondary: '#5F6570',
    },
    divider: '#DDD6C8',
  },
  typography: {
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: {
      fontFamily: '"Source Serif 4", Newsreader, Georgia, "Times New Roman", serif',
    },
    h2: {
      fontFamily: '"Source Serif 4", Newsreader, Georgia, "Times New Roman", serif',
    },
    h3: {
      fontFamily: '"Source Serif 4", Newsreader, Georgia, "Times New Roman", serif',
    },
    h4: {
      fontFamily: '"Source Serif 4", Newsreader, Georgia, "Times New Roman", serif',
    },
  },
  breakpoints: {
    values: {
      xs: 0,
      sm: 640,
      md: 768,
      lg: 1024,
      xl: 1280,
    },
  },
});

export default theme;
