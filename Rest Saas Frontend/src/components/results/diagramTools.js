export function downloadDiagram(svg, filename, bounds) {
  if (!svg) return;
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const width = bounds?.width || svg.viewBox.baseVal.width;
  const height = bounds?.height || svg.viewBox.baseVal.height;
  if (bounds) clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
