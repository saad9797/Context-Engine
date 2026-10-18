import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Link from "@mui/material/Link";
import { Link as RouterLink } from "react-router-dom";

// Consistent page-top pattern: title + one-line description, primary action
// right-aligned, optional breadcrumb trail for nested pages.
export default function PageHeader({
  title,
  description,
  action,
  breadcrumbs,
  sx,
}) {
  return (
    <Box
      sx={{
        mb: 4,
        ...sx,
      }}
    >
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumbs
          sx={{
            mb: 1,
            fontSize: "0.8125rem",
          }}
          separator="/"
        >
          {breadcrumbs.map((b, i) =>
            b.to ? (
              <Link
                key={i}
                component={RouterLink}
                to={b.to}
                underline="hover"
                color="text.secondary"
                sx={{
                  fontSize: "0.8125rem",
                }}
              >
                {b.label}
              </Link>
            ) : (
              <Typography key={i} variant="body2" color="text.primary">
                {b.label}
              </Typography>
            ),
          )}
        </Breadcrumbs>
      )}
      <Stack
        direction={{
          xs: "column",
          sm: "row",
        }}
        spacing={2}
        sx={{
          justifyContent: "space-between",
          alignItems: {
            sm: "center",
          },
        }}
      >
        <Box>
          <Typography variant="h4" component="h1">
            {title}
          </Typography>
          {description && (
            <Typography
              variant="body2"
              sx={{
                mt: 1,
                maxWidth: 580,
                lineHeight: 1.8,
              }}
            >
              {description}
            </Typography>
          )}
        </Box>
        {action && (
          <Box
            sx={{
              flexShrink: 0,
            }}
          >
            {action}
          </Box>
        )}
      </Stack>
    </Box>
  );
}
