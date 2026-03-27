export interface Piece {
  id: string;
  title: string;
  description?: string;
  author?: string;
  dateAdded: string;
  type: 'ascii' | 'bitmap';
  inputType: 'image' | 'text';
  inputText?: string;
  inputImageDataURL?: string;
  gridCols: number;
  invert: boolean;
  threshold: number;
  charSet?: string;
  customChars?: string;
  font?: string;
  showPreviewGrid?: boolean;
  includeGridInSavedImage?: boolean;
}

export type SortOption = 'date-desc' | 'date-asc' | 'title-az' | 'title-za';

export type SortMode = 'alphabetical' | 'date' | 'bitmap' | 'ascii';

export const CHAR_SETS: Record<string, string> = {
  Standard: '@#S%?*+;:,.',
  Blocks: '█▓▒░ ',
  Binary: '01',
  Braille: '⠿⠷⠯⠟⠻⠽⠾⠼⠸⠰⠠ ',
  Custom: '',
};

export const FONT_OPTIONS = [
  { value: 'Courier New', label: 'Courier New' },
  { value: 'IBM Plex Mono', label: 'IBM Plex Mono' },
  { value: 'Fira Code', label: 'Fira Code' },
  { value: 'Space Mono', label: 'Space Mono' },
  { value: 'Inconsolata', label: 'Inconsolata' },
  { value: 'Courier Prime', label: 'Courier Prime' },
] as const;
