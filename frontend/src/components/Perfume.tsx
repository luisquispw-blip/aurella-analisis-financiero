// Ilustración de un frasco de perfume (SVG propio, sin imágenes externas)
export default function Perfume({ ancho = 150 }: { ancho?: number }) {
  return (
    <svg width={ancho} viewBox="0 0 200 260" role="img" aria-label="Frasco de perfume">
      <defs>
        <linearGradient id="vidrio" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f7eedb" />
          <stop offset="0.45" stopColor="#e2c27a" />
          <stop offset="1" stopColor="#b8892b" />
        </linearGradient>
        <linearGradient id="liquido" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d4a94a" stopOpacity="0.85" />
          <stop offset="1" stopColor="#9a6a1c" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="tapa" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0b1a31" />
          <stop offset="0.5" stopColor="#1f3d6e" />
          <stop offset="1" stopColor="#0b1a31" />
        </linearGradient>
        <radialGradient id="brillo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#d4a94a" stopOpacity="0.35" />
          <stop offset="1" stopColor="#d4a94a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="100" cy="150" rx="95" ry="100" fill="url(#brillo)" />
      {/* tapa */}
      <rect x="72" y="18" width="56" height="44" rx="6" fill="url(#tapa)" />
      <rect x="80" y="24" width="6" height="32" rx="3" fill="#ffffff" opacity="0.18" />
      <rect x="86" y="62" width="28" height="14" rx="2" fill="#b8892b" />
      {/* frasco */}
      <rect x="34" y="76" width="132" height="160" rx="22" fill="url(#vidrio)" stroke="#b8892b" strokeWidth="2" />
      <rect x="44" y="118" width="112" height="108" rx="16" fill="url(#liquido)" />
      <rect x="46" y="86" width="12" height="130" rx="6" fill="#ffffff" opacity="0.35" />
      {/* etiqueta */}
      <rect x="62" y="138" width="76" height="46" rx="4" fill="#0f2340" stroke="#d4a94a" strokeWidth="1.5" />
      <text x="100" y="160" textAnchor="middle" fontFamily="'Cormorant Garamond', Georgia, serif" fontSize="17" fontWeight="700" fill="#e9d9ae" letterSpacing="3">AURELLA</text>
      <text x="100" y="175" textAnchor="middle" fontFamily="Poppins, sans-serif" fontSize="6.5" fill="#d4a94a" letterSpacing="2">EAU DE PARFUM</text>
      <ellipse cx="100" cy="242" rx="70" ry="6" fill="#0b1a31" opacity="0.12" />
    </svg>
  );
}
