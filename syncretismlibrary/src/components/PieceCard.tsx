import type { Piece } from '../types';
import { renderPreviewSync, getPreviewAsync } from '../preview';
import { useState, useEffect } from 'react';

interface PieceCardProps {
  piece: Piece;
  onClick: () => void;
  cardRef?: (el: HTMLElement | null) => void;
}

export function PieceCard({ piece, onClick, cardRef }: PieceCardProps) {
  const syncPreview = renderPreviewSync(piece);
  const [asyncPreview, setAsyncPreview] = useState<typeof syncPreview>(null);

  useEffect(() => {
    if (syncPreview) return;
    let cancelled = false;
    getPreviewAsync(piece).then((r) => {
      if (!cancelled) setAsyncPreview(r);
    });
    return () => {
      cancelled = true;
    };
  }, [piece.id, piece.inputImageDataURL, piece.inputText, piece.gridCols, piece.threshold, piece.invert, piece.type, piece.charSet, piece.customChars, syncPreview]);

  const preview = syncPreview ?? asyncPreview;
  const dateStr = new Date(piece.dateAdded).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  if (!preview) {
    return (
      <article
        ref={cardRef}
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => e.key === 'Enter' && onClick()}
        className="flex cursor-pointer flex-col overflow-hidden border border-border bg-bg-card transition-colors hover:border-accent hover:shadow-sm"
      >
        <div className="flex aspect-square w-full items-center justify-center border-b border-border bg-bg p-2">
          <span className="text-xs text-muted">…</span>
        </div>
        <div className="flex flex-1 flex-col gap-1 p-3">
          <h2 className="font-normal text-text line-clamp-1">{piece.title}</h2>
          {piece.author && (
            <p className="text-sm text-muted">{piece.author}</p>
          )}
          <p className="text-xs text-muted">{dateStr}</p>
          <span
            className={`mt-auto inline-block w-fit px-2 py-0.5 text-xs font-medium ${
              piece.type === 'ascii'
                ? 'bg-border text-text'
                : 'bg-border text-text'
            }`}
          >
            {piece.type === 'ascii' ? 'ASCII' : 'BITMAP'}
          </span>
        </div>
      </article>
    );
  }

  const type = preview.type;
  const asciiThumbnail =
    type === 'ascii'
      ? (() => {
          const lines = preview.output.split('\n');
          if (!lines.length) return '';
          const maxRows = 40;
          const maxCols = 40;
          const rowStep = Math.max(1, Math.floor(lines.length / maxRows));
          const sampled: string[] = [];
          for (let i = 0; i < lines.length; i += rowStep) {
            const line = lines[i] ?? '';
            if (line.length <= maxCols) {
              sampled.push(line);
            } else {
              const colStep = Math.max(1, Math.floor(line.length / maxCols));
              let s = '';
              for (let c = 0; c < line.length; c += colStep) {
                s += line[c] ?? ' ';
              }
              sampled.push(s);
            }
          }
          return sampled.join('\n');
        })()
      : '';

  return (
    <article
      ref={cardRef}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className="flex cursor-pointer flex-col overflow-hidden border border-border bg-bg-card transition-colors hover:border-accent hover:shadow-sm"
    >
      <div className="relative aspect-square w-full border-b border-border bg-bg overflow-hidden">
        {type === 'ascii' ? (
          <pre
            className="absolute inset-0 h-full w-full overflow-hidden text-center font-mono text-[6px] leading-[7px] text-text whitespace-pre"
            style={{ fontFamily: 'IBM Plex Mono, monospace' }}
          >
            {asciiThumbnail}
          </pre>
        ) : (
          <BitmapThumbnail grid={preview.grid} />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h2 className="font-normal text-text line-clamp-1">{piece.title}</h2>
        {piece.author && (
          <p className="text-sm text-muted">{piece.author}</p>
        )}
        <p className="text-xs text-muted">{dateStr}</p>
        <span className="mt-auto inline-block w-fit bg-border px-2 py-0.5 text-xs font-medium text-text">
          {piece.type === 'ascii' ? 'ASCII' : 'BITMAP'}
        </span>
      </div>
    </article>
  );
}

function BitmapThumbnail({ grid }: { grid: number[][] }) {
  if (!grid.length) return <span className="text-xs text-muted">…</span>;
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  return (
    <svg
      viewBox={`0 0 ${cols} ${rows}`}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 h-full w-full border border-border"
      style={{ imageRendering: 'pixelated' }}
    >
      {grid.map((row, y) =>
        row.map((v, x) => (
          <rect
            key={`${y}-${x}`}
            x={x}
            y={y}
            width={1}
            height={1}
            fill={v ? '#1a1a1a' : '#f7f5f0'}
          />
        ))
      )}
    </svg>
  );
}
