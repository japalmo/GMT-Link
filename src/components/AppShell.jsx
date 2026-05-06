import { useState } from 'react';
import { Outlet, useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
import {
  Box, Drawer, AppBar, Toolbar, IconButton, Typography,
  List, ListItemButton, ListItemIcon, ListItemText,
  Divider, Avatar, Tooltip, useMediaQuery, useTheme, Menu, MenuItem, Breadcrumbs, Link,
} from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import PeopleOutlinedIcon from '@mui/icons-material/PeopleOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded';
import logoWide from '../assets/branding/logo-wide.png';
import logoMid from '../assets/branding/logo-mid.png';
import logoCompact from '../assets/branding/logo-compact.png';
import { useAuth } from '../contexts/AuthContext';

const DRAWER_WIDTH = 280;
const COLLAPSED_DRAWER_WIDTH = 88;

const NAV_ITEMS = [
  { label: 'Dashboard',           path: '/',                      icon: <DashboardOutlinedIcon /> },
  { label: 'Reembolsos',          path: '/reembolsos',            icon: <ReceiptLongOutlinedIcon /> },
  { label: 'Pagos',               path: '/pagos',                 icon: <PaymentsOutlinedIcon /> },
  { label: 'Trabajadores',        path: '/trabajadores',          icon: <PeopleOutlinedIcon /> },
  { label: 'Configuración',       path: '/configuracion',         icon: <TuneOutlinedIcon /> },
];

const WORKER_NAV_ITEMS = [
  { label: 'Dashboard', path: '/', icon: <DashboardOutlinedIcon /> },
  { label: 'Mis Reembolsos', path: '/mis-solicitudes', icon: <ReceiptLongOutlinedIcon /> },
];

export default function AppShell() {
  const { profile, logout, user } = useAuth();
  const theme = useTheme();
  const drawerTransitionMs = theme.transitions.duration.shorter;
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const isLargeDesktop = useMediaQuery(theme.breakpoints.up('lg'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [accountAnchorEl, setAccountAnchorEl] = useState(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeDrawerWidth = isMobile ? DRAWER_WIDTH : (isCollapsed ? COLLAPSED_DRAWER_WIDTH : DRAWER_WIDTH);
  const currentLogo = isSmallScreen ? logoCompact : (isCollapsed ? logoMid : (isLargeDesktop ? logoWide : logoMid));
  const logoMaxWidth = isSmallScreen ? 48 : (isCollapsed ? 68 : (isLargeDesktop ? 176 : 132));
  const logoScale = isSmallScreen ? 1.08 : (isCollapsed ? 1.14 : (isLargeDesktop ? 1 : 1.22));
  const navItems = (profile?.role === 'worker' || profile?.role === 'trabajador') ? WORKER_NAV_ITEMS : NAV_ITEMS;
  const displayName = profile?.displayName || profile?.email || 'Usuario';
  const roleLabel = (profile?.role === 'worker' || profile?.role === 'trabajador') ? 'trabajador' : (profile?.role || 'usuario');
  const avatarLetter = displayName.charAt(0).toUpperCase();
  const accountMenuOpen = Boolean(accountAnchorEl);

  const handleNav = (path) => {
    navigate(path);
    if (isMobile) setMobileOpen(false);
  };

  const handleOpenAccountMenu = (event) => {
    setAccountAnchorEl(event.currentTarget);
  };

  const handleAccountClose = () => setAccountAnchorEl(null);

  const handleOpenProfile = () => {
    handleAccountClose();
    navigate('/perfil');
  };

  const handleLogout = async () => {
    handleAccountClose();
    await logout();
    navigate('/login', { replace: true });
  };

  const pathParts = pathname.split('/').filter(Boolean);
  const breadcrumbs = [
    { label: profile?.role === 'worker' ? 'Inicio' : 'Dashboard', path: '/' },
    ...pathParts.map((part, index) => {
      const display = part.replace(/-/g, ' ');
      return {
        label: display.charAt(0).toUpperCase() + display.slice(1),
        path: '/' + pathParts.slice(0, index + 1).join('/'),
      };
    }),
  ].filter((item, index, self) => index === self.findIndex((i) => i.path === item.path));

  const renderBrandLogo = () => (
    <Box
      sx={{
        width: '100%',
        minHeight: isSmallScreen ? 40 : (isCollapsed ? 42 : 62),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: isSmallScreen ? 0.5 : (isCollapsed ? 0.5 : 1.5),
        py: isSmallScreen ? 0.25 : (isCollapsed ? 0.4 : 0.75),
        overflow: 'hidden',
        transition: theme.transitions.create(['min-height', 'padding'], {
          duration: drawerTransitionMs,
        }),
        '@keyframes logoFadeIn': {
          from: { opacity: 0, transform: 'translateY(3px) scale(0.985)' },
          to: { opacity: 1, transform: 'translateY(0) scale(1)' },
        },
      }}
    >
      <Box
        key={`${currentLogo}-${logoMaxWidth}`}
        component="img"
        src={currentLogo}
        alt="GMT Link"
        sx={{
          display: 'block',
          width: '100%',
          maxWidth: logoMaxWidth,
          height: 'auto',
          objectFit: 'contain',
          transform: `scale(${logoScale})`,
          transformOrigin: 'center center',
          animation: `logoFadeIn ${drawerTransitionMs}ms ${theme.transitions.easing.easeInOut}`,
        }}
      />
    </Box>
  );

  const drawerContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.paper' }}>
      <Box
        sx={{
          px: isCollapsed && !isMobile ? 0.75 : 1.75,
          py: isCollapsed && !isMobile ? 1 : 1.5,
          transition: theme.transitions.create(['padding'], { duration: drawerTransitionMs }),
        }}
      >
        {renderBrandLogo()}
      </Box>

      <Divider sx={{ borderColor: 'rgba(0,0,0,0.04)', mx: 2 }} />

      <List sx={{ flex: 1, pt: 2, px: 1.5 }}>
        {navItems.map(({ label, path, icon }) => (
          <Tooltip key={path} title={isCollapsed && !isMobile ? label : ''} placement="right">
            <ListItemButton
              selected={pathname === path || (path !== '/' && pathname.startsWith(path))}
              onClick={() => handleNav(path)}
              sx={{
                justifyContent: isCollapsed && !isMobile ? 'center' : 'flex-start',
                px: isCollapsed && !isMobile ? 1.25 : 2,
                borderRadius: 2.5,
                mb: 0.5,
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                '&.Mui-selected': {
                  bgcolor: `${theme.palette.primary.main}08`,
                  color: 'primary.main',
                  '& .MuiListItemIcon-root': { color: 'primary.main' },
                  '&:hover': { bgcolor: `${theme.palette.primary.main}12` },
                },
                '&:hover': {
                  bgcolor: 'rgba(0,0,0,0.02)',
                  transform: isCollapsed ? 'none' : 'translateX(4px)',
                }
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: isCollapsed && !isMobile ? 'auto' : 40,
                  mr: isCollapsed && !isMobile ? 0 : 1,
                  justifyContent: 'center',
                  color: pathname === path || (path !== '/' && pathname.startsWith(path)) ? 'primary.main' : 'text.secondary',
                  transition: theme.transitions.create(['min-width', 'margin'], {
                    duration: drawerTransitionMs,
                  }),
                }}
              >
                {icon}
              </ListItemIcon>
              {!isCollapsed || isMobile ? (
                <ListItemText 
                  primary={label} 
                  primaryTypographyProps={{ 
                    fontWeight: pathname === path || (path !== '/' && pathname.startsWith(path)) ? 700 : 600, 
                    fontSize: '0.875rem' 
                  }} 
                />
              ) : null}
            </ListItemButton>
          </Tooltip>
        ))}
      </List>

      <Box sx={{ p: 2, mt: 'auto' }}>
        <Paper 
          variant="outlined" 
          sx={{ 
            p: 1.5, 
            borderRadius: 3, 
            display: isCollapsed && !isMobile ? 'none' : 'flex', 
            alignItems: 'center', 
            gap: 1.5,
            borderColor: 'rgba(0,0,0,0.05)',
            bgcolor: 'rgba(0,0,0,0.01)'
          }}
        >
          <Avatar sx={{ width: 32, height: 32, fontSize: '0.8rem', bgcolor: 'primary.main', fontWeight: 800 }}>
            {avatarLetter}
          </Avatar>
          <Box sx={{ overflow: 'hidden' }}>
            <Typography variant="caption" fontWeight={700} display="block" noWrap sx={{ lineHeight: 1 }}>
              {displayName}
            </Typography>
            <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'capitalize' }}>
              {roleLabel}
            </Typography>
          </Box>
        </Paper>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box
        component="nav"
        sx={{
          width: { md: activeDrawerWidth },
          flexShrink: { md: 0 },
          transition: theme.transitions.create('width', { duration: drawerTransitionMs }),
        }}
      >
        <Drawer
          variant={isMobile ? 'temporary' : 'permanent'}
          open={isMobile ? mobileOpen : true}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            '& .MuiDrawer-paper': {
              width: activeDrawerWidth,
              boxSizing: 'border-box',
              overflowX: 'hidden',
              borderRight: '1px solid rgba(0,0,0,0.05)',
              transition: theme.transitions.create('width', { duration: drawerTransitionMs }),
            },
          }}
        >
          {drawerContent}
        </Drawer>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <AppBar 
          position="sticky" 
          elevation={0} 
          sx={{ 
            bgcolor: 'rgba(255,255,255,0.7)', 
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid rgba(0,0,0,0.04)',
            color: 'text.primary'
          }}
        >
          <Toolbar sx={{ px: { xs: 2, md: 3 } }}>
            <IconButton
              edge="start"
              onClick={() => {
                if (isMobile) {
                  setMobileOpen(true);
                } else {
                  setIsCollapsed((current) => !current);
                }
              }}
              sx={{ mr: 1.5, color: 'text.secondary' }}
            >
              {isMobile ? <MenuIcon /> : (isCollapsed ? <ChevronRightRoundedIcon /> : <ChevronLeftRoundedIcon />)}
            </IconButton>
            <Box sx={{ flex: 1 }}>
              <Breadcrumbs 
                aria-label="breadcrumb"
                sx={{ 
                  '& .MuiBreadcrumbs-li': { fontWeight: 600, fontSize: '0.85rem' },
                  '& .MuiBreadcrumbs-separator': { mx: 0.5, color: 'text.disabled' }
                }}
              >
                {breadcrumbs.map((item, index) => (
                  <Link
                    key={item.path}
                    component={RouterLink}
                    to={item.path}
                    underline="none"
                    color={index === breadcrumbs.length - 1 ? 'text.primary' : 'text.secondary'}
                    sx={{ 
                      transition: 'color 0.2s',
                      '&:hover': { color: 'primary.main' }
                    }}
                  >
                    {item.label}
                  </Link>
                ))}
              </Breadcrumbs>
            </Box>
            <Tooltip title="Cuenta">
              <Avatar
                onClick={handleOpenAccountMenu}
                sx={{ 
                  width: 36, 
                  height: 36, 
                  bgcolor: 'primary.main', 
                  fontSize: 14, 
                  cursor: 'pointer',
                  fontWeight: 800,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  transition: 'transform 0.2s',
                  '&:hover': { transform: 'scale(1.05)' }
                }}
              >
                {avatarLetter}
              </Avatar>
            </Tooltip>
            <Menu
              anchorEl={accountAnchorEl}
              open={accountMenuOpen}
              onClose={handleAccountClose}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              slotProps={{
                paper: {
                  sx: {
                    width: 280,
                    mt: 1.5,
                    borderRadius: 4,
                    boxShadow: '0 10px 40px rgba(0,0,0,0.12)',
                    p: 1,
                    '& .MuiMenuItem-root': {
                      borderRadius: 2,
                      py: 1,
                      mb: 0.5,
                      gap: 1.5
                    }
                  },
                },
              }}
            >
              <Box sx={{ px: 2, py: 1.5 }}>
                <Typography variant="subtitle2" fontWeight={800} color="text.primary">{displayName}</Typography>
                <Typography variant="body2" color="text.secondary" fontWeight={500}>{user?.email || profile?.email}</Typography>
                <Chip 
                  label={roleLabel} 
                  size="small" 
                  color="primary" 
                  variant="outlined" 
                  sx={{ mt: 1, height: 20, fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase' }} 
                />
              </Box>
              <Divider sx={{ my: 1, opacity: 0.6 }} />
              <MenuItem onClick={handleOpenProfile}>
                <ListItemIcon sx={{ color: 'text.secondary', minWidth: '0 !important' }}><PersonOutlineRoundedIcon fontSize="small" /></ListItemIcon>
                <ListItemText
                  primary="Mi Perfil"
                  primaryTypographyProps={{ fontWeight: 700, fontSize: '0.9rem' }}
                />
              </MenuItem>
              <MenuItem onClick={handleLogout} sx={{ color: 'error.main' }}>
                <ListItemIcon sx={{ color: 'inherit', minWidth: '0 !important' }}><LogoutRoundedIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary="Cerrar Sesión" primaryTypographyProps={{ fontWeight: 700, fontSize: '0.9rem' }} />
              </MenuItem>
            </Menu>
          </Toolbar>
        </AppBar>

        <Box component="main" sx={{ flex: 1, p: { xs: 2, md: 4 }, bgcolor: 'background.default', overflow: 'hidden' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </Box>
      </Box>
    </Box>
  );
}
