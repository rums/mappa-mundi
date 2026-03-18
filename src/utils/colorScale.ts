export type ColorScale = {
  low: string;
  high: string;
  midpoint?: string;
};

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

function lerp(a: [number, number, number], b: [number, number, number], t: number): string {
  return toHex(
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  );
}

export function interpolateColor(value: number, scale: ColorScale): string {
  const t = Math.max(0, Math.min(1, value));
  const low = parseHex(scale.low);
  const high = parseHex(scale.high);

  if (scale.midpoint != null) {
    const mid = parseHex(scale.midpoint);
    if (t <= 0.5) {
      return lerp(low, mid, t / 0.5);
    } else {
      return lerp(mid, high, (t - 0.5) / 0.5);
    }
  }

  return lerp(low, high, t);
}

export function scoreToColor(score: number | undefined, scale: ColorScale): string {
  if (score === undefined || isNaN(score)) {
    return '#9e9e9e';
  }
  return interpolateColor(score, scale);
}
