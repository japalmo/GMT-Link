import { createTheme } from '@mui/material/styles';

const gmtNavy = '#1C3A6B';
const gmtBlue = '#2563EB';
const gmtGold = '#D97706';

const theme = createTheme({
  palette: {
    primary: {
      main: gmtNavy,
      light: '#2E5099',
      dark: '#0F2244',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: gmtGold,
      light: '#F59E0B',
      dark: '#B45309',
      contrastText: '#FFFFFF',
    },
    background: {
      default: '#F1F5F9',
      paper: '#FFFFFF',
    },
    text: {
      primary: '#0F172A',
      secondary: '#475569',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h5: { fontWeight: 700 },
    h6: { fontWeight: 600 },
    subtitle1: { fontWeight: 500 },
  },
  shape: {
    borderRadius: 10,
  },
  components: {
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: gmtNavy,
          color: '#FFFFFF',
          borderRight: 'none',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          margin: '2px 8px',
          width: 'calc(100% - 16px)',
          '&:hover': { backgroundColor: 'rgba(255,255,255,0.12)' },
          '&.Mui-selected': {
            backgroundColor: gmtBlue,
            '&:hover': { backgroundColor: '#1D4ED8' },
          },
        },
      },
    },
    MuiListItemIcon: {
      styleOverrides: {
        root: { color: 'rgba(255,255,255,0.7)', minWidth: 40 },
      },
    },
    MuiListItemText: {
      styleOverrides: {
        primary: { color: '#FFFFFF', fontSize: '0.875rem', fontWeight: 500 },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#FFFFFF',
          color: '#0F172A',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { boxShadow: '0 1px 4px rgba(0,0,0,0.08)', borderRadius: 12 },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 600 },
      },
    },
  },
});

export default theme;
