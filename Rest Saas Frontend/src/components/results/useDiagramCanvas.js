import { useCallback, useEffect, useRef, useState } from 'react';

export function fitCamera(world, viewport) {
  const scale = Math.min(viewport.width / (world.width + 60), viewport.height / (world.height + 60), 1);
  return { scale, x: (world.width - viewport.width / scale) / 2, y: (world.height - viewport.height / scale) / 2 };
}
export function zoomCamera(camera, factor, point) {
  const scale = Math.min(3, Math.max(.01, camera.scale * factor));
  return { scale, x: camera.x + point.x / camera.scale - point.x / scale, y: camera.y + point.y / camera.scale - point.y / scale };
}

export default function useDiagramCanvas(width, height) {
  const container = useRef(null);
  const dragged = useRef(false);
  const pointers = useRef(new Map());
  const [viewport, setViewport] = useState({ width: 1000, height: 640 });
  const [camera, setCamera] = useState(() => fitCamera({ width, height }, viewport));
  const [panning, setPanning] = useState(false);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => { const bounds = element.getBoundingClientRect(); if (bounds.width && bounds.height) setViewport({ width: bounds.width, height: bounds.height }); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width, height]);
  const fit = useCallback(() => setCamera(fitCamera({ width, height }, viewport)), [width, height, viewport]);
  useEffect(fit, [fit]);
  const zoom = useCallback((factor, point = { x: viewport.width / 2, y: viewport.height / 2 }) => setCamera(value => zoomCamera(value, factor, point)), [viewport]);
  const center = useCallback(point => setCamera(value => ({ ...value, x: point.x - viewport.width / value.scale / 2, y: point.y - viewport.height / value.scale / 2 })), [viewport]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const wheel = event => {
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      zoom(Math.exp(-event.deltaY * .002), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [zoom]);
  const handlers = {
    onPointerDown(event) {
      if (event.button !== 0) return;
      if (!pointers.current.size) dragged.current = false;
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    },
    onPointerMove(event) {
      const previous = pointers.current.get(event.pointerId);
      if (!previous) return;
      const before = [...pointers.current.values()];
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
      if (Math.abs(dx) + Math.abs(dy) < 2) return;
      dragged.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setPanning(true);
      if (pointers.current.size === 2) {
        const after = [...pointers.current.values()];
        const distance = points => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        const bounds = event.currentTarget.getBoundingClientRect();
        const center = { x: (after[0].x + after[1].x) / 2 - bounds.left, y: (after[0].y + after[1].y) / 2 - bounds.top };
        setCamera(value => zoomCamera({ ...value, x: value.x - dx / 2 / value.scale, y: value.y - dy / 2 / value.scale }, distance(after) / Math.max(1, distance(before)), center));
      } else setCamera(value => ({ ...value, x: value.x - dx / value.scale, y: value.y - dy / value.scale }));
    },
    onPointerUp(event) { pointers.current.delete(event.pointerId); if (!pointers.current.size) setPanning(false); },
    onPointerCancel(event) { pointers.current.delete(event.pointerId); setPanning(false); },
    onKeyDown(event) {
      if (event.target !== event.currentTarget) return;
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.25); }
      else if (event.key === '-') { event.preventDefault(); zoom(.8); }
      else if (event.key.toLowerCase() === 'f') { event.preventDefault(); fit(); }
      else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        setCamera(value => ({ ...value, x: value.x + (event.key === 'ArrowLeft' ? -80 : event.key === 'ArrowRight' ? 80 : 0) / value.scale, y: value.y + (event.key === 'ArrowUp' ? -80 : event.key === 'ArrowDown' ? 80 : 0) / value.scale }));
      }
    },
  };
  return { container, camera, viewport, zoom, center, fit, handlers, dragged, panning, viewBox: `${camera.x} ${camera.y} ${viewport.width / camera.scale} ${viewport.height / camera.scale}` };
}
