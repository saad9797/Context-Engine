import React from "react";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

export default function EntityRow({ name, meta, children }) {
  return (
    <Accordion variant="outlined" disableGutters sx={{ mb: 1, "&:before": { display: "none" } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ width: "100%", pr: 1 }}>
          <Typography sx={{ fontFamily: (t) => t.tokens.fontMono, fontWeight: 600, fontSize: 13 }}>{name}</Typography>
          <Stack direction="row" spacing={1.5} sx={{ fontSize: 11.5, color: "text.secondary" }}>{meta}</Stack>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>{children}</AccordionDetails>
    </Accordion>
  );
}
