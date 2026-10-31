# ERD explorer experience

The ERD uses a searchable schema explorer beside a single fitted canvas. The
design takes cues from dbdiagram's schema search and detail-level controls:

- https://docs.dbdiagram.io/dbdocs/getting-started/explore/
- https://docs.dbdiagram.io/diagram-detail-levels/
- https://www.drawdb.app/editor

## Navigation

The database opens fitted to the canvas. Compact table cards, tighter gutters,
height-aware packing, and a layout chosen for the viewport reduce unused space.
Schemas have consistent accent colors. Schemas with more than 12 tables start
with key fields visible; smaller schemas show all fields. Users can select
Tables, Keys only, or All fields without leaving the board.

Search covers table/column names, types, defaults, notes, and captured enum
values. It updates the explorer and highlights matches without moving tables or
resetting the viewport. Choose a result, or press Enter, to locate it at a readable
scale. Searching for a column exposes all fields when needed. It does not query
live row values or display customer records.

Selecting a table explains its references in an inspector within the explorer.
Relationship entries navigate directly to the referenced field. Focus related
tables temporarily isolates the table and its neighbors. Fit all tables restores
the complete database. The inspector stays on the board when the explorer is
hidden. On narrow screens, the explorer sits above the canvas.

The board retains wheel/pinch zoom, drag pan, a compact minimap, expanded view,
keyboard canvas controls, and full-diagram SVG export. Ctrl/Cmd+F focuses schema
search. Escape clears the search or exits expanded view. Snapshot data remains
read-only.

## Verification

The ERD suite covers legacy constraints, null schema data, composite and self
references, non-overlapping layouts, fit and zoom geometry, stable search,
column navigation, metadata/enum search, default detail levels, related-table
focus, and restoring the full database.
