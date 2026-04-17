import type { Piece } from './types';
import {
  imageToCanvas,
  textToCanvas,
  canvasToAscii,
  canvasToBitmap,
  getCharSetForPiece,
} from './conversion';
import { resolvePieceImageSource } from './lib/storageApiClient';

export type PreviewResult =
  | { type: 'ascii'; output: string; cols: number; rows: number }
  | { type: 'bitmap'; grid: number[][]; cols: number; rows: number };

function getChars(piece: Piece): string {
  const name = piece.charSet ?? 'Standard';
  if (name === 'Custom') {
    return piece.customChars ?? '@';
  }
  return getCharSetForPiece(name, '');
}

/** Sync preview for text-only input. For image input, returns null and you must use getPreviewAsync. */
export function renderPreviewSync(piece: Piece): PreviewResult | null {
  const cols = Math.max(20, Math.min(200, piece.gridCols));
  const font = piece.font ?? 'IBM Plex Mono';
  const chars = getChars(piece);

  if (piece.inputType === 'image' && resolvePieceImageSource(piece)) {
    return null;
  }
  const text = piece.inputText ?? '';
  const { canvas, ctx } = textToCanvas(text, cols, font);

  if (piece.type === 'ascii') {
    const { output, cols: c, rows: r } = canvasToAscii(
      canvas,
      ctx,
      chars,
      piece.invert,
      piece.threshold
    );
    return { type: 'ascii', output, cols: c, rows: r };
  }
  const { grid, cols: c, rows: r } = canvasToBitmap(
    canvas,
    ctx,
    piece.threshold,
    piece.invert
  );
  return { type: 'bitmap', grid, cols: c, rows: r };
}

/** Async preview for any piece (required for image input). */
export async function getPreviewAsync(piece: Piece): Promise<PreviewResult> {
  const cols = Math.max(20, Math.min(200, piece.gridCols));
  const chars = getChars(piece);

  const imageSource = resolvePieceImageSource(piece);
  if (piece.inputType === 'image' && imageSource) {
    const { canvas, ctx } = await imageToCanvas(imageSource, cols);
    if (piece.type === 'ascii') {
      const out = canvasToAscii(
        canvas,
        ctx,
        chars,
        piece.invert,
        piece.threshold
      );
      return { type: 'ascii', ...out };
    }
    const out = canvasToBitmap(
      canvas,
      ctx,
      piece.threshold,
      piece.invert
    );
    return { type: 'bitmap', ...out };
  }
  const sync = renderPreviewSync(piece);
  return sync ?? { type: 'ascii', output: '', cols: 0, rows: 0 };
}

/** For components that need a sync result: text = sync, image = placeholder until async loads. */
export function renderPreview(piece: Piece): PreviewResult {
  const sync = renderPreviewSync(piece);
  if (sync) return sync;
  return piece.type === 'ascii'
    ? { type: 'ascii', output: '…', cols: 0, rows: 0 }
    : { type: 'bitmap', grid: [], cols: 0, rows: 0 };
}
