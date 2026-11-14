// Proste ikony SVG (obrys 24×24).
const P: Record<string, React.ReactNode> = {
  select: <path d="M5 3l14 8-6 1.5L10 19z" />,
  box: (
    <>
      <path d="M4 7.5L12 3l8 4.5v9L12 21l-8-4.5z" />
      <path d="M4 7.5L12 12l8-4.5M12 12v9" />
    </>
  ),
  cylinder: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
    </>
  ),
  sphere: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <ellipse cx="12" cy="12" rx="8.5" ry="3" />
    </>
  ),
  cone: (
    <>
      <path d="M12 3L5 18M12 3l7 15" />
      <ellipse cx="12" cy="18" rx="7" ry="3" />
    </>
  ),
  torus: (
    <>
      <ellipse cx="12" cy="12" rx="9" ry="5.5" />
      <ellipse cx="12" cy="11.5" rx="3.5" ry="1.6" />
    </>
  ),
  prism: (
    <>
      <path d="M7 4h10l4 4-4 4H7L3 8z" />
      <path d="M3 8v8l4 4h10l4-4V8M7 12v8M17 12v8" />
    </>
  ),
  wedge: (
    <>
      <path d="M3 18h14l4-4H7z" />
      <path d="M3 18V8l4-4v10M3 8l14 10M7 4l14 10" />
    </>
  ),
  fit: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />,
  redo: <path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />,
  sketch: (
    <>
      <path d="M3 21l3-1 12-12-2-2L4 18z" />
      <path d="M14 6l2-2 4 4-2 2" />
    </>
  ),
  line: (
    <>
      <path d="M5 19L19 5" />
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="5" r="2" />
    </>
  ),
  rect: <rect x="4" y="6" width="16" height="12" />,
  circle: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  polygon: <path d="M12 3l8.5 6.2-3.2 10H6.7L3.5 9.2z" />,
  arc3: (
    <>
      <path d="M4 18A10 10 0 0120 18" />
      <circle cx="4" cy="18" r="1.6" />
      <circle cx="12" cy="9" r="1.6" />
      <circle cx="20" cy="18" r="1.6" />
    </>
  ),
  arcc: (
    <>
      <path d="M20 12A8 8 0 0112 20" />
      <path d="M12 12h8M12 12v8" strokeDasharray="2 2" />
      <circle cx="12" cy="12" r="1.6" />
    </>
  ),
  fillet2d: <path d="M4 20V10a6 6 0 016-6h10" />,
  fill: (
    <>
      <path d="M4 5h16v14H4z" />
      <path d="M4 12l7-7M4 19L18 5M10 19l10-10M16 19l4-4" />
    </>
  ),
  extrude: (
    <>
      <path d="M4 16l8 4 8-4-8-4z" />
      <path d="M12 12V3M9 6l3-3 3 3" />
    </>
  ),
  hole: (
    <>
      <path d="M3 9l9-5 9 5v6l-9 5-9-5z" />
      <ellipse cx="12" cy="10" rx="3" ry="1.6" />
    </>
  ),
  union: (
    <>
      <circle cx="9" cy="12" r="6" />
      <circle cx="15" cy="12" r="6" />
    </>
  ),
  subtract: (
    <>
      <path d="M12 7.2A6 6 0 1012 16.8 6 6 0 0112 7.2z" />
      <circle cx="15" cy="12" r="6" strokeDasharray="2 2" />
    </>
  ),
  intersect: (
    <>
      <circle cx="9" cy="12" r="6" strokeDasharray="2 2" />
      <circle cx="15" cy="12" r="6" strokeDasharray="2 2" />
      <path d="M12 7.2a6 6 0 010 9.6 6 6 0 010-9.6z" />
    </>
  ),
  fillet: (
    <>
      <path d="M4 20V12a8 8 0 018-8h8" />
      <path d="M4 20h16V4" strokeDasharray="2 2" />
    </>
  ),
  chamfer: (
    <>
      <path d="M4 20V10l6-6h10" />
      <path d="M4 20h16V4" strokeDasharray="2 2" />
    </>
  ),
  erase: (
    <>
      <path d="M8 20h12M4 15l9-9 6 6-7 7H8z" />
      <path d="M9 10l6 6" />
    </>
  ),
  measure: (
    <>
      <path d="M3 17L17 3l4 4L7 21z" />
      <path d="M7 13l2 2M10 10l2 2M13 7l2 2" />
    </>
  ),
  import: <path d="M12 3v12M7 10l5 5 5-5M4 17v3h16v-3" />,
  export: <path d="M12 15V3M7 8l5-5 5 5M4 17v3h16v-3" />,
  bambu: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 17h8M12 7v6M9 10l3 3 3-3" />
    </>
  ),
  save: (
    <>
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M8 3v5h7V3M8 21v-7h8v7" />
    </>
  ),
  open: <path d="M3 19V5h6l2 2h10v12zM3 10h18" />,
  new: <path d="M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </>
  ),
  grid: <path d="M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18" />,
  magnet: <path d="M6 3v8a6 6 0 0012 0V3h-4v8a2 2 0 01-4 0V3zM6 7h4M14 7h4" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 115 0c0 2-2.5 2-2.5 4M12 17h.01" />
    </>
  ),
  check: <path d="M4 12l5 5L20 6" />,
  close: <path d="M5 5l14 14M19 5L5 19" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  layers: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" />,
};

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name] ?? <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}
