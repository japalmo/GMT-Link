import { Box, Typography } from '@mui/material';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';

export default function EmptyState({ title, description }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8, px: 2, textAlign: 'center' }}>
      <InboxOutlinedIcon sx={{ fontSize: 64, color: 'text.secondary', opacity: 0.4, mb: 2 }} />
      <Typography variant="h6" color="text.secondary">{title}</Typography>
      <Typography variant="body2" color="text.secondary">{description}</Typography>
    </Box>
  );
}
