import { useState, useEffect, useRef } from 'react';
import type { Piece } from '../types';
import { getPreviewAsync } from '../preview';
import { bitmapToBinaryString } from '../conversion';
import type { PreviewResult } from '../preview';
import { resolvePieceImageSource } from '../lib/storageApiClient';

interface DetailModalProps {
  piece: Piece | null;
  open: boolean;
  onClose: () => void;
  onEdit: (piece: Piece) => void;
  onDelete: (id: string) => void;
}

function getPieceChipLabel(piece: Piece): string {
  if (piece.type === 'binary') return 'BINARY';
  if (piece.pieceKind === 'weave') return 'PATTERN';
  if (piece.pieceKind === 'pattern') return 'PATTERN';
  const title = piece.title.toLowerCase();
  if (title.includes('pattern')) return 'PATTERN';
  if (title.includes('weave')) return 'PATTERN';
  return piece.type === 'ascii' ? 'ASCII' : 'BITMAP';
}

function isWeavePiece(piece: Piece): boolean {
  if (piece.pieceKind === 'weave') return true;
  if (piece.pieceKind === 'pattern') return false;
  return piece.title.toLowerCase().includes('weave');
}

function getSavedWeaveVerticalGeometry(cols: number, rows: number): {
  topOffsetRatio: number;
  rowHeightRatio: number;
} {
  const topPad = 24;
  const bottomPad = 8;
  const cell = Math.max(8, Math.floor(900 / Math.max(cols, rows)));
  const canvasHeight = topPad + rows * cell + bottomPad;
  return {
    topOffsetRatio: topPad / canvasHeight,
    rowHeightRatio: cell / canvasHeight,
  };
}

function getWeaveDimensions(piece: Piece): { warps: number; wefts: number } | null {
  if (piece.weaveWarps && piece.weaveWefts) {
    return {
      warps: Math.max(1, Math.floor(piece.weaveWarps)),
      wefts: Math.max(1, Math.floor(piece.weaveWefts)),
    };
  }
  const desc = piece.description ?? '';
  const match = desc.match(/(\d+)\s*warps\s*[×x]\s*(\d+)\s*wefts/i);
  if (!match) return null;
  const warps = Number(match[1]);
  const wefts = Number(match[2]);
  if (!Number.isFinite(warps) || !Number.isFinite(wefts)) return null;
  return { warps: Math.max(1, Math.floor(warps)), wefts: Math.max(1, Math.floor(wefts)) };
}

export function DetailModal({
  piece,
  open,
  onClose,
  onEdit,
  onDelete,
}: DetailModalProps) {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [bitmapZoom, setBitmapZoom] = useState(1);
  const [activeWeaveRow, setActiveWeaveRow] = useState(1);
  const bitmapScrollRef = useRef<HTMLDivElement>(null);
  const bitmapDragRef = useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });

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

  useEffect(() => {
    setBitmapZoom(1);
    setActiveWeaveRow(1);
    const el = bitmapScrollRef.current;
    if (el) {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    }
  }, [piece?.id, open]);

  useEffect(() => {
    const dims = piece && isWeavePiece(piece) ? getWeaveDimensions(piece) : null;
    const maxRows =
      dims?.wefts ??
      (preview && (preview.type === 'bitmap' || preview.type === 'binary')
        ? preview.rows
        : null);
    if (!maxRows) return;
    setActiveWeaveRow((row) =>
      Math.min(Math.max(1, row), maxRows)
    );
  }, [preview, piece]);

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
            ctx.fillStyle =
              preview.type === 'binary'
                ? v === 0
                  ? '#1a1a1a'
                  : '#f7f5f0'
                : v
                  ? '#1a1a1a'
                  : '#f7f5f0';
            ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
          }
        }
      }

      if (piece.includeGridInSavedImage) {
        drawGridOverlayOnCanvas(ctx, preview.cols, preview.rows, cellSize);
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

  const handleCopyBinary = async () => {
    if (!piece) return;
    try {
      if (piece.type === 'binary') {
        const patternPreview = await getPreviewAsync(piece);
        if (patternPreview.type !== 'binary') return;
        await navigator.clipboard.writeText(
          bitmapToBinaryString(patternPreview.grid)
        );
        alert('Copied binary to clipboard');
        return;
      }
      // For non-binary types, copy bitmap 0/1 grid representation.
      const binaryPreview = await getPreviewAsync({ ...piece, type: 'bitmap' });
      if (binaryPreview.type !== 'bitmap') return;
      await navigator.clipboard.writeText(
        bitmapToBinaryString(binaryPreview.grid)
      );
      alert('Copied binary to clipboard');
    } catch (err) {
      console.error(err);
      alert('Copy failed');
    }
  };

  const handleCopyAscii = async () => {
    if (!piece) return;
    try {
      const asciiPreview = await getPreviewAsync({ ...piece, type: 'ascii' });
      if (asciiPreview.type !== 'ascii') return;
      await navigator.clipboard.writeText(asciiPreview.output);
      alert('Copied ASCII to clipboard');
    } catch (err) {
      console.error(err);
      alert('Copy failed');
    }
  };

  const handleSaveBinaryImage = async () => {
    if (!piece) return;
    try {
      const binaryPreview =
        piece.type === 'binary'
          ? await getPreviewAsync(piece)
          : await getPreviewAsync({ ...piece, type: 'bitmap' });
      if (binaryPreview.type !== 'bitmap' && binaryPreview.type !== 'binary') return;

      const cellSize = 8;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = binaryPreview.cols * cellSize;
      canvas.height = binaryPreview.rows * cellSize;

      ctx.fillStyle = '#f7f5f0';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let y = 0; y < binaryPreview.rows; y++) {
        const row = binaryPreview.grid[y] ?? [];
        for (let x = 0; x < binaryPreview.cols; x++) {
          const v = row[x] ?? 0;
            ctx.fillStyle =
              binaryPreview.type === 'binary'
                ? v === 0
                  ? '#1a1a1a'
                  : '#f7f5f0'
                : v
                  ? '#1a1a1a'
                  : '#f7f5f0';
          ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
      }

      drawGridOverlayOnCanvas(
        ctx,
        binaryPreview.cols,
        binaryPreview.rows,
        cellSize
      );

      canvas.toBlob(
        (blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.download = `${(piece.title ?? 'syncretismlibrary').replace(
            /[^a-z0-9]/gi,
            '_'
          )}_binary_grid.png`;
          link.href = url;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 100);
        },
        'image/png'
      );
    } catch (err) {
      console.error(err);
      alert('Binary export failed');
    }
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
  const originalImageSource = resolvePieceImageSource(piece);
  const chipLabel = getPieceChipLabel(piece);
  const weavePiece = isWeavePiece(piece);
  const weaveImageSource = weavePiece ? originalImageSource : undefined;
  const weaveDims = weavePiece ? getWeaveDimensions(piece) : null;
  const binaryPiece = piece.type === 'binary';

  const zoomOut = () =>
    setBitmapZoom((z) => Math.max(0.5, Number((z - 0.1).toFixed(2))));
  const zoomIn = () =>
    setBitmapZoom((z) => Math.min(4, Number((z + 0.1).toFixed(2))));
  const resetView = () => {
    setBitmapZoom(1);
    const el = bitmapScrollRef.current;
    if (el) {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    }
  };

  const onBitmapPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = bitmapScrollRef.current;
    if (!el) return;
    bitmapDragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onBitmapPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = bitmapScrollRef.current;
    const drag = bitmapDragRef.current;
    if (!el || !drag.dragging) return;
    el.scrollLeft = drag.scrollLeft - (e.clientX - drag.startX);
    el.scrollTop = drag.scrollTop - (e.clientY - drag.startY);
  };

  const onBitmapPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    bitmapDragRef.current.dragging = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onBitmapWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const step = 0.08;
    if (e.deltaY > 0) {
      setBitmapZoom((z) => Math.max(0.5, Number((z - step).toFixed(2))));
    } else {
      setBitmapZoom((z) => Math.min(4, Number((z + step).toFixed(2))));
    }
  };

  const rowStepperActive =
    (weavePiece || binaryPiece) &&
    (preview?.type === 'bitmap' || preview?.type === 'binary');
  const maxWeaveRows =
    rowStepperActive
      ? weaveDims?.wefts ?? (preview?.rows ?? 1)
      : 1;
  const activeHighlightRowIndex = rowStepperActive ? activeWeaveRow - 1 : null;
  const weaveGeometry =
    weaveDims
      ? getSavedWeaveVerticalGeometry(weaveDims.warps, weaveDims.wefts)
      : null;

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
            {chipLabel}
          </span>
          {piece.author && (
            <span className="text-sm text-muted">by {piece.author}</span>
          )}
          <span className="text-sm text-muted">| {dateStr}</span>
        </header>

        <div className="flex-1 overflow-auto p-6">
          {preview ? (
            preview.type === 'ascii' ? (
              <div className="inline-block min-w-0 border border-border bg-bg p-4">
                <pre
                  className="whitespace-pre font-mono text-text text-sm leading-tight"
                  style={{ fontFamily: 'IBM Plex Mono, monospace' }}
                >
                  {preview.output}
                </pre>
              </div>
            ) : (
              <div className="w-full">
                <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-muted">
                  <span>
                    {rowStepperActive
                      ? `Row ${activeWeaveRow} of ${maxWeaveRows} · drag to pan, use +/- to zoom.`
                      : 'Drag to pan, use +/- to zoom.'}
                  </span>
                  <div className="flex items-center gap-2 text-xs">
                    {rowStepperActive && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setActiveWeaveRow((row) =>
                              Math.min(maxWeaveRows, row + 1)
                            )
                          }
                          disabled={activeWeaveRow >= maxWeaveRows}
                          className="border border-border px-2 py-1 text-text hover:bg-border disabled:opacity-50"
                        >
                          Next row
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveWeaveRow(1)}
                          className="border border-border px-2 py-1 text-text hover:bg-border"
                        >
                          Row 1
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={zoomOut}
                      className="border border-border px-2 py-1 text-text hover:bg-border"
                    >
                      -
                    </button>
                    <span className="min-w-12 text-center text-muted">
                      {Math.round(bitmapZoom * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={zoomIn}
                      className="border border-border px-2 py-1 text-text hover:bg-border"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={resetView}
                      className="border border-border px-2 py-1 text-text hover:bg-border"
                    >
                      Reset
                    </button>
                  </div>
                </div>
                <div
                  ref={bitmapScrollRef}
                  onPointerDown={onBitmapPointerDown}
                  onPointerMove={onBitmapPointerMove}
                  onPointerUp={onBitmapPointerUp}
                  onPointerCancel={onBitmapPointerUp}
                  onWheel={onBitmapWheel}
                  className="max-h-[70vh] overflow-auto border border-border bg-bg p-2 cursor-grab active:cursor-grabbing"
                  style={{ touchAction: 'none' }}
                >
                  <div
                    className="inline-block origin-top-left"
                    style={{ transform: `scale(${bitmapZoom})` }}
                  >
                    {weaveImageSource ? (
                      <div className="relative">
                        <img
                          src={weaveImageSource}
                          alt={piece.title}
                          draggable={false}
                          className="block w-full h-auto border border-border bg-[#f7f5f0]"
                          style={{ imageRendering: 'pixelated' }}
                        />
                        {weaveGeometry && (
                          <svg
                            className="pointer-events-none absolute inset-0 h-full w-full"
                            viewBox="0 0 100 100"
                            preserveAspectRatio="none"
                            aria-hidden="true"
                          >
                            {Array.from(
                              { length: Math.max(0, maxWeaveRows + 1) },
                              (_, idx) => {
                                const yPct =
                                  (weaveGeometry.topOffsetRatio +
                                    idx * weaveGeometry.rowHeightRatio) *
                                  100;
                                return (
                                  <line
                                    key={`weave-row-${idx}`}
                                    x1="0"
                                    y1={yPct}
                                    x2="100"
                                    y2={yPct}
                                    stroke="rgba(0,0,0,0.08)"
                                    strokeWidth="0.08"
                                  />
                                );
                              }
                            )}
                          </svg>
                        )}
                        {(preview.type === 'bitmap' || preview.type === 'binary') &&
                          activeHighlightRowIndex != null &&
                          weaveGeometry && (
                            <div
                              className="pointer-events-none absolute left-0 right-0 border-y"
                              style={{
                                top: `${(weaveGeometry.topOffsetRatio + activeHighlightRowIndex * weaveGeometry.rowHeightRatio) * 100}%`,
                                height: `${weaveGeometry.rowHeightRatio * 100}%`,
                                backgroundColor: 'rgba(59,130,246,0.2)',
                                borderColor: 'rgba(59,130,246,0.8)',
                              }}
                            />
                          )}
                        {(preview.type === 'bitmap' || preview.type === 'binary') &&
                          activeHighlightRowIndex != null &&
                          weaveGeometry && (
                            <div
                              className="pointer-events-none absolute -left-12 rounded border border-border bg-bg-card px-2 py-1 text-[11px] text-text"
                              style={{
                                top: `${(weaveGeometry.topOffsetRatio + activeHighlightRowIndex * weaveGeometry.rowHeightRatio + weaveGeometry.rowHeightRatio / 2) * 100}%`,
                                transform: 'translateY(-50%)',
                              }}
                            >
                              {activeWeaveRow}
                            </div>
                          )}
                      </div>
                    ) : (
                      <BitmapDisplay
                        grid={preview.grid}
                        mode={preview.type === 'binary' ? 'binary' : 'bitmap'}
                        showBinaryRowLabels={preview.type === 'binary'}
                        highlightRowIndex={
                          rowStepperActive ? activeHighlightRowIndex : null
                        }
                      />
                    )}
                  </div>
                </div>
              </div>
            )
          ) : (
            <span className="text-muted">Loading…</span>
          )}

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
                ) : originalImageSource ? (
                  <img
                    src={originalImageSource}
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
            onClick={handleSaveBinaryImage}
            className="border border-accent bg-bg px-4 py-2 text-sm font-medium text-accent hover:bg-border"
          >
            Save Binary + Grid
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
            onClick={handleCopyAscii}
            className="border border-border px-4 py-2 text-sm text-text hover:bg-border"
          >
            Copy ASCII
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

function drawGridOverlayOnCanvas(
  ctx: CanvasRenderingContext2D,
  cols: number,
  rows: number,
  cellSize: number
) {
  ctx.save();
  for (let x = 0; x <= cols; x++) {
    ctx.strokeStyle =
      x % 10 === 0 ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x * cellSize + 0.5, 0);
    ctx.lineTo(x * cellSize + 0.5, rows * cellSize);
    ctx.stroke();
  }
  for (let y = 0; y <= rows; y++) {
    ctx.strokeStyle =
      y % 10 === 0 ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y * cellSize + 0.5);
    ctx.lineTo(cols * cellSize, y * cellSize + 0.5);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.font = `${Math.max(10, cellSize * 2)}px "IBM Plex Mono", monospace`;
  for (let x = 0; x <= cols; x += 10) {
    ctx.fillText(String(x), x * cellSize + 2, 12);
  }
  for (let y = 0; y <= rows; y += 10) {
    ctx.fillText(String(y), 2, y * cellSize + 12);
  }
  ctx.restore();
}

function BitmapDisplay({
  grid,
  mode,
  showBinaryRowLabels,
  highlightRowIndex,
}: {
  grid: number[][];
  mode: 'bitmap' | 'binary';
  showBinaryRowLabels: boolean;
  highlightRowIndex: number | null;
}) {
  if (!grid.length) return null;
  const cols = grid[0]?.length ?? 0;
  const rows = grid.length;
  const labelGutter = showBinaryRowLabels ? 4 : 0;
  const viewBox = `${-labelGutter} 0 ${cols + labelGutter} ${rows}`;
  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      className="block w-full h-auto border border-border bg-[#f7f5f0]"
      style={{ imageRendering: 'pixelated' }}
    >
      {showBinaryRowLabels &&
        Array.from({ length: Math.floor(rows / 5) }, (_, i) => (i + 1) * 5).map(
          (rowNum) => (
            <text
              key={`row-label-${rowNum}`}
              x={-0.5}
              y={Math.min(rowNum - 0.2, rows - 0.2)}
              textAnchor="end"
              fontSize={0.9}
              fill="rgba(0,0,0,0.55)"
            >
              {rowNum}
            </text>
          )
        )}
      {grid.map((row, y) =>
        row.map((v, x) => (
          <rect
            key={`${y}-${x}`}
            x={x}
            y={y}
            width={1}
            height={1}
            fill={mode === 'binary' ? (v === 0 ? '#1a1a1a' : '#f7f5f0') : v ? '#1a1a1a' : '#f7f5f0'}
          />
        ))
      )}
      {highlightRowIndex != null &&
        highlightRowIndex >= 0 &&
        highlightRowIndex < rows && (
          <rect
            x={0}
            y={highlightRowIndex}
            width={cols}
            height={1}
            fill="rgba(59,130,246,0.2)"
            stroke="rgba(59,130,246,0.8)"
            strokeWidth={0.08}
          />
        )}
    </svg>
  );
}
