interface SparklineProps {
  /** Array of numeric values */
  values: number[];
  /** SVG width (default 120) */
  width?: number;
  /** SVG height (default 32) */
  height?: number;
  /** Line color (default '#34d399' emerald-400) */
  color?: string;
  /** Show a filled area below the line (default true) */
  fill?: boolean;
  /** Line thickness (default 1.5) */
  strokeWidth?: number;
}

export default function Sparkline({
  values,
  width = 120,
  height = 32,
  color = '#34d399',
  fill = true,
  strokeWidth = 1.5,
}: SparklineProps) {
  if (values.length < 2) {
    return (
      <svg width={width} height={height} className="flex-shrink-0">
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={color}
          strokeWidth={strokeWidth}
          opacity={0.3}
        />
      </svg>
    );
  }

  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * w;
    const y = pad + h - ((v - min) / range) * h;
    return `${x},${y}`;
  });

  const polylinePoints = points.join(' ');

  // For fill polygon: close the shape by going to bottom-right, bottom-left
  const fillPoints = `${polylinePoints} ${pad + w},${pad + h} ${pad},${pad + h}`;

  return (
    <svg width={width} height={height} className="flex-shrink-0">
      {fill && <polygon points={fillPoints} fill={color} opacity={0.1} />}
      <polyline
        points={polylinePoints}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
