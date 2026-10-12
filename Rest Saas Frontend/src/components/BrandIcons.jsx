import React from "react";

// @mui/icons-material ships Material icons only, no brand logos — these are
// the standard GitHub mark and Google's official 4-color "G" (Google's
// brand guidelines for "Sign in with Google" buttons call for this exact
// mark, not a monochrome substitute).

const FONT_SIZE_PX = { small: 18, medium: 22, large: 28 };

// Accepts MUI's icon-prop conventions (`fontSize="small"`, `color`) so these
// drop into the same call sites as an @mui/icons-material icon would,
// without leaking non-SVG attributes onto the raw <svg> element.
function resolveSize({ fontSize, width, height }) {
  if (width || height) return { width, height };
  const px = typeof fontSize === "number" ? fontSize : FONT_SIZE_PX[fontSize] || FONT_SIZE_PX.medium;
  return { width: px, height: px };
}

export function GitHubIcon({ fontSize, width, height, color, ...rest }) {
  const size = resolveSize({ fontSize, width, height });
  return (
    <svg {...size} viewBox="0 0 24 24" fill="currentColor" {...rest}>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.34-1.28-1.69-1.28-1.69-1.04-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.8 1.19 1.83 1.19 3.09 0 4.43-2.69 5.41-5.26 5.69.42.36.78 1.07.78 2.17 0 1.56-.01 2.82-.01 3.2 0 .3.21.66.8.55A10.51 10.51 0 0 0 23.5 12c0-6.35-5.15-11.5-11.5-11.5z" />
    </svg>
  );
}

export function GoogleIcon({ fontSize, width, height, color, ...rest }) {
  const size = resolveSize({ fontSize, width, height });
  return (
    <svg {...size} viewBox="0 0 48 48" {...rest}>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.4-.3-3.5z"/>
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5c-7.7 0-14.4 4.4-17.7 10.2z"/>
      <path fill="#4CAF50" d="M24 43.5c5.4 0 10.3-1.9 14.1-5.1l-6.5-5.5C29.4 34.6 26.9 35.5 24 35.5c-5.3 0-9.7-3.3-11.3-8l-6.6 5.1C9.5 39 16.2 43.5 24 43.5z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.4l6.5 5.5C39.6 37 43.5 31.3 43.5 24c0-1.2-.1-2.4-.3-3.5z"/>
    </svg>
  );
}
