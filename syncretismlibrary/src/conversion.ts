import { CHAR_SETS } from './types';

function brightness(r: number, g: number, b: number): number {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

export function imageToCanvas(
  imageSource: HTMLImageElement | string,
  cols: number
): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('No 2d context'));
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const aspect = img.height / img.width;
      canvas.width = cols;
      canvas.height = Math.max(1, Math.round(cols * aspect));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve({ canvas, ctx });
    };
    img.onerror = () => reject(new Error('Image load failed'));

    if (typeof imageSource === 'string') {
      img.src = imageSource;
    } else {
      img.src = imageSource.src;
    }
  });
}

export function textToCanvas(
  text: string,
  cols: number,
  font: string = '16px "IBM Plex Mono", monospace'
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const fontSize = Math.max(8, Math.floor(cols * 0.8));
  ctx.font = `${fontSize}px ${font}`;
  const metrics = ctx.measureText(text);
  const textWidth = Math.ceil(metrics.width);
  const lineHeight = fontSize * 1.2;
  const lines = text.split('\n').length;
  const height = Math.ceil(lines * lineHeight);
  canvas.width = Math.max(cols, Math.ceil(textWidth / 8) * 8);
  canvas.height = Math.max(1, height);
  ctx.font = `${fontSize}px ${font}`;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';
  const lineList = text.split('\n');
  lineList.forEach((line, i) => {
    ctx.fillText(line, 0, i * lineHeight);
  });
  return { canvas, ctx };
}

export function getPixelBrightness(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  invert: boolean
): number {
  const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
  let bri = brightness(r, g, b);
  if (invert) bri = 255 - bri;
  return bri;
}

export function canvasToAscii(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  chars: string,
  invert: boolean,
  threshold: number
): { output: string; cols: number; rows: number } {
  const w = canvas.width;
  const h = canvas.height;
  if (!chars.length) chars = '@';
  const lines: string[] = [];
  for (let y = 0; y < h; y++) {
    let line = '';
    for (let x = 0; x < w; x++) {
      let bri = getPixelBrightness(ctx, x, y, invert);
      // threshold as midpoint: normalize so threshold maps to middle of char set
      const normalized = Math.max(0, Math.min(1, (bri - threshold) / 255 + 0.5));
      const idx = Math.min(
        chars.length - 1,
        Math.floor(normalized * chars.length)
      );
      line += chars[idx] ?? chars[0];
    }
    lines.push(line);
  }
  return { output: lines.join('\n'), cols: w, rows: h };
}

export function canvasToBitmap(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  threshold: number,
  invert: boolean
): { grid: number[][]; cols: number; rows: number } {
  const w = canvas.width;
  const h = canvas.height;
  const grid: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row: number[] = [];
    for (let x = 0; x < w; x++) {
      let bri = getPixelBrightness(ctx, x, y, false);
      let on = bri < threshold ? 1 : 0;
      if (invert) on = 1 - on;
      row.push(on);
    }
    grid.push(row);
  }
  return { grid, cols: w, rows: h };
}

export function bitmapToBinaryString(grid: number[][]): string {
  return grid.map((row) => row.join('')).join('\n');
}

export function getCharSetForPiece(charSetName: string, customChars: string): string {
  if (charSetName === 'Custom') return customChars || '@';
  return CHAR_SETS[charSetName] ?? CHAR_SETS.Standard;
}
