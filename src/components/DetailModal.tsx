import { useState, useEffect, useRef } from 'react';
import type { Piece } from '../types';
import { getPreviewAsync } from '../preview';
import { bitmapToBinaryString } from '../conversion';
import type { PreviewResult } from '../preview';

interface DetailModalProps {
  piece: Piece | null;
  open: boolean;
  onClose: () => void;
  onEdit: (piece: Piece) => void;
  onDelete: (id: string) => void;
}

export function DetailModal({
  piece,
  open,
  onClose,
  onEdit,
  onDelete,
}: DetailModalProps) {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const artRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !piece) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    getPreviewAsync(piece).then((r) => {
      if (!cancelled) setPreview(r);
    });
    return () => {
      cancelled = true;
    };
  }, [open, piece?.id]);

  const handleSaveImage = () => {
    if (!preview || !piece) return;
    try {
      const cellSize = 4;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = preview.cols * cellSize;
      canvas.height = preview.rows * cellSize;

      ctx.fillStyle = '#f7f5f0';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (preview.type === 'ascii') {
        ctx.fillStyle = '#1a1a1a';
        ctx.font = `${cellSize * 2}px "IBM Plex Mono", monospace`;
        ctx.textBaseline = 'top';
        const lines = preview.output.split('\n');
        lines.forEach((line, row) => {
          ctx.fillText(line, 0, row * cellSize * 2.2);
        });
      } else {
        for (let y = 0; y < preview.rows; y++) {
          const row = preview.grid[y] ?? [];
          for (let x = 0; x < preview.cols; x++) {
            const v = row[x] ?? 0;
            ctx.fillStyle = v ? '#1a1a1a' : '#f7f5f0';
            ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
          }
        }
      }

      canvas.toBlob(
        (blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.download = `${(piece.title ?? 'syncretismlibrary').replace(/[^a-z0-9]/gi, '_')}.png`;
          link.href = url;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 100);
        },
        'image/png'
      );
    } catch (err) {
      console.error(err);
      alert('Export failed');
    }
  };

  const handleCopyBinary = () => {
    if (!preview) return;
    if (preview.type === 'ascii') {
      navigator.clipboard.writeText(preview.output);
    } else {
      navigator.clipboard.writeText(bitmapToBinaryString(preview.grid));
    }
    alert('Copied to clipboard');
  };

  const handleDelete = () => {
    if (!piece) return;
    if (window.confirm(`Delete "${piece.title}"?`)) {
      onDelete(piece.id);
      onClose();
    }
  };

  if (!open || !piece) return null;

  const dateStr = new Date(piece.dateAdded).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 font-sans"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden border border-border bg-bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
          <h2 className="text-xl font-normal text-text">{piece.title}</h2>
          <span className=" bg-border px-2 py-0.5 text-xs font-medium text-text">
            {piece.type === 'ascii' ? 'ASCII' : 'BITMAP'}
          </span>
          {piece.author && (
            <span className="text-sm text-muted">by {piece.author}</span>
          )}
          <span className="text-sm text-muted">| {dateStr}</span>
        </header>

        <div className="flex-1 overflow-auto p-6">
          <div
            ref={artRef}
            className="inline-block min-w-0 border border-border bg-bg p-4"
          >
            {preview ? (
              preview.type === 'ascii' ? (
                <pre
                  className="whitespace-pre font-mono text-text text-sm leading-tight"
                  style={{ fontFamily: 'IBM Plex Mono, monospace' }}
                >
                  {preview.output}
                </pre>
              ) : (
                <BitmapDisplay grid={preview.grid} />
              )
            ) : (
              <span className="text-muted">Loading…</span>
            )}
          </div>

          <details className="mt-6 border border-border">
            <summary className="cursor-pointer px-4 py-2 text-sm text-text">
              Details
            </summary>
            <div className="space-y-3 border-t border-border px-4 py-3 text-sm">
              {piece.description && (
                <p className="text-muted">{piece.description}</p>
              )}
              <div>
                <span className="text-muted">Original input: </span>
                {piece.inputType === 'text' ? (
                  <pre className="mt-1 whitespace-pre-wrap bg-bg p-2 font-mono text-text">
                    {piece.inputText || '(empty)'}
                  </pre>
                ) : piece.inputImageDataURL ? (
                  <img
                    src={piece.inputImageDataURL}
                    alt="Original"
                    className="mt-1 max-h-40 border border-border object-contain"
                  />
                ) : (
                  <span className="text-muted">—</span>
                )}
              </div>
            </div>
          </details>
        </div>

        <footer className="flex flex-wrap gap-2 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={handleSaveImage}
            className="border border-accent bg-bg px-4 py-2 text-sm font-medium text-accent hover:bg-border"
          >
            Save Image
          </button>
          <button
            type="button"
            onClick={handleCopyBinary}
            className="border border-border px-4 py-2 text-sm text-text hover:bg-border"
          >
            Copy Binary
          </button>
          <button
            type="button"
            onClick={() => onEdit(piece)}
            className="border border-border px-4 py-2 text-sm text-text hover:bg-border"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="border border-red-500/50 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto border border-border px-4 py-2 text-sm text-text hover:bg-border"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

function BitmapDisplay({ grid }: { grid: number[][] }) {
  if (!grid.length) return null;
  const cell = 6;
  const w = (grid[0]?.length ?? 0) * cell;
  const h = grid.length * cell;
  return (
    <svg
      width={w}
      height={h}
      className="border border-border"
      style={{ imageRendering: 'pixelated' }}
    >
      {grid.map((row, y) =>
        row.map((v, x) => (
          <rect
            key={`${y}-${x}`}
            x={x * cell}
            y={y * cell}
            width={cell}
            height={cell}
            fill={v ? '#1a1a1a' : '#f7f5f0'}
          />
        ))
      )}
    </svg>
  );
}
