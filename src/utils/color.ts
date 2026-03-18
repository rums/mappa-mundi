export const COLORBLIND_SAFE_PALETTE: string[] = [
  '#1b9e77',
  '#d95f02',
  '#7570b3',
  '#e7298a',
  '#66a61e',
  '#e6ab02',
  '#a6761d',
  '#666666',
  '#1f78b4',
  '#b2df8a',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash);
}

export function regionColor(id: string): string {
  const index = hashString(id) % COLORBLIND_SAFE_PALETTE.length;
  return COLORBLIND_SAFE_PALETTE[index];
}
