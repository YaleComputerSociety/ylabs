import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  breakpoints: {
    values: {
      xs: 0,
      sm: 640,  // Tailwind 'sm'
      md: 768,  // Tailwind 'md'
      lg: 1024, // Tailwind 'lg'
      xl: 1280, // Tailwind 'xl'
    },
  },
});

export default theme;