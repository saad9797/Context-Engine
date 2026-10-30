import React from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  Stack,
  Chip,
} from "@mui/material";
import ArrowForward from "@mui/icons-material/ArrowForward";
import DataObject from "@mui/icons-material/DataObject";
import SystemArchitecture from "./SystemArchitecture";

export default function ProjectAtGlance({
  graph,
  data,
  context,
  onExplore,
  onPrepare,
}) {
  if (!graph && !context) return null;
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "1fr",
          lg: graph && context ? "minmax(0, 1.8fr) minmax(250px, 1fr)" : "1fr",
        },
        gap: 2.5,
        mb: 4,
      }}
    >
      {graph && (
        <Card>
          <CardContent>
            <Stack
              direction="row"
              sx={{
                justifyContent: "space-between",
                alignItems: "center",
                mb: 2,
              }}
            >
              <Box>
                <Typography variant="subtitle1">
                  Your architecture, connected
                </Typography>
                <Typography variant="caption">
                  How the application, databases, and files fit together
                </Typography>
              </Box>
              <Button
                size="small"
                onClick={onExplore}
                endIcon={<ArrowForward sx={{ fontSize: 14 }} />}
              >
                Explore
              </Button>
            </Stack>
            <SystemArchitecture data={data} compact />
          </CardContent>
        </Card>
      )}
      {context && (
        <Card sx={{ bgcolor: "action.selected" }}>
          <CardContent
            sx={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              p: 3,
            }}
          >
            <DataObject sx={{ fontSize: 26, color: "primary.main", mb: 2.5 }} />
            <Typography
              variant="overline"
              sx={{ color: "primary.main", fontSize: 9, letterSpacing: 1 }}
            >
              YOUR NEXT AI SESSION
            </Typography>
            <Typography variant="h6" sx={{ mt: 1, mb: 1.5 }}>
              Skip the explanation.
              <br />
              Start with the context.
            </Typography>
            <Typography variant="body2" sx={{ lineHeight: 1.9, mb: 2 }}>
              Paste your project conventions once. Then send only the models,
              code, and requirements needed for each task.
            </Typography>
            <Chip
              variant="outlined"
              label="Base pack + task pack"
              size="small"
              sx={{ alignSelf: "flex-start", mb: 3 }}
            />
            <Button
              variant="contained"
              endIcon={<ArrowForward />}
              onClick={onPrepare}
              sx={{ mt: "auto", alignSelf: "flex-start" }}
            >
              Prepare AI packs
            </Button>
            <Typography variant="caption" sx={{ fontSize: 10, mt: 1.5 }}>
              Choose a task and token budget on the next screen.
            </Typography>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
