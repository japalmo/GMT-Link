import { Box, Typography, useTheme } from '@mui/material';
import { motion } from 'framer-motion';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';

export default function EmptyState({ title, description }) {
  const theme = useTheme();

  return (
    <Box 
      component={motion.div}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
      sx={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center', 
        py: 10, 
        px: 2, 
        textAlign: 'center' 
      }}
    >
      <InboxOutlinedIcon sx={{ fontSize: 72, color: 'text.disabled', opacity: 0.5, mb: 2.5 }} />
      <Typography variant="h6" color="text.primary" fontWeight={700} gutterBottom>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" fontWeight={500} sx={{ maxWidth: 320 }}>
        {description}
      </Typography>
    </Box>
  );
}
