const PALETTE = [
  "#0d7377",
  "#2e6b9e",
  "#6b4f8a",
  "#2e7d52",
  "#7a4d2e",
  "#1e5c8a",
  "#6b6b2e",
  "#7a2d5c",
];

export const getAvatarColor = (name: string): string => {
  if (!name) return PALETTE[0];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
};
