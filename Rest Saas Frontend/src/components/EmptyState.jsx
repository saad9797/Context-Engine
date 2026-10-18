import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";

// One shared "nothing here yet" pattern: icon, one-line title, one-line
// explanation of why it's empty, optional call-to-action. Used for whole
// page/section empty states — inline "no X yet, add one" hints inside a
// form stay as plain Alerts (a different, intentionally terser pattern).
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  bare = false,
}) {
  const content = (
    <Box
      sx={{
        textAlign: "center",
        py: 7,
        px: 3,
      }}
    >
      {Icon && (
        <Icon
          sx={{
            fontSize: 30,
            color: "text.secondary",
            mb: 1.5,
          }}
        />
      )}
      <Typography
        sx={{
          fontWeight: 600,
          mb: 0.5,
        }}
      >
        {title}
      </Typography>
      {description && (
        <Typography
          variant="body2"
          sx={{
            mb: action ? 2.5 : 0,
            maxWidth: 360,
            mx: "auto",
          }}
        >
          {description}
        </Typography>
      )}
      {action}
    </Box>
  );
  if (bare) return content;
  return <Card variant="outlined">{content}</Card>;
}
