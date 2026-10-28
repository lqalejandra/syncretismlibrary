import {
  useState,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import html2canvas from 'html2canvas';
import {
  direct_utils,
  computeDrawdown,
  calcWidth,
  calcLength,
  numFrames,
  numTreadles,
} from 'adacad-drafting-lib/loom';
import type { Loom, LoomSettings } from 'adacad-drafting-lib/loom';
import {
  initDraftFromDrawdown,
  wefts,
  warps,
  getDraftName,
  isUp,
  isSet,
} from 'adacad-drafting-lib/draft';
import type { Drawdown } from 'adacad-drafting-lib/draft';
import type { Piece } from '../types';
import { getPreviewAsync } from '../preview';

/** Binary / pattern / weave pieces are the best weave sources. */
function isPreferredWeaveSource(piece: Piece): boolean {
  if (piece.type === 'binary') return true;
  if (piece.pieceKind === 'pattern' || piece.pieceKind === 'weave') return true;
  const title = piece.title.toLowerCase();
  return title.includes('pattern') || title.includes('weave');
}

function pieceOptionLabel(piece: Piece): string {
  const base = piece.author
    ? `${piece.title} — ${piece.author}`
    : piece.title;
  if (isPreferredWeaveSource(piece)) return base;
  const via =
    piece.type === 'ascii'
      ? 'ASCII → bitmap'
      : piece.type === 'bitmap'
        ? 'bitmap'
        : piece.type;
  return `${base} (${via})`;
}

function downloadTextFile(filename: string, contents: string) {
  const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function downloadDataUrl(filename: string, dataUrl: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

function formatDressingList(loom: Loom, pieceTitle: string): string {
  const lines: string[] = [
    `Weave dressing — ${pieceTitle}`,
    `Direct tie-up · ${loom.threading.length} warps × ${loom.treadling.length} wefts`,
    `Frames: ${numFrames(loom)} · Treadles: ${numTreadles(loom)}`,
    '',
    'Threading (warp → shaft, 0-based; -1 = unset)',
    loom.threading.map((shaft, i) => `  ${i + 1}: ${shaft}`).join('\n'),
    '',
    'Treadling (pick → shafts lifted)',
  ];
  loom.treadling.forEach((row, i) => {
    lines.push(`  ${i + 1}: [${row.join(', ')}]`);
  });
  lines.push('', 'Tie-up (shaft × treadle, true = connected)');
  loom.tieup.forEach((row, si) => {
    lines.push(
      `  shaft ${si + 1}: ${row.map((on) => (on ? '1' : '0')).join('')}`
    );
  });
  return lines.join('\n');
}

interface WeaveModalProps {
  open: boolean;
  pieces: Piece[];
  onSaveToLibrary: (piece: Piece) => Promise<void> | void;
  initialSelectedId?: string | null;
  editPieceId?: string | null;
  onClose: () => void;
}

/** Direct tie-up: frames/treadles expand to what the pattern needs (no user cap UI). */
const DIRECT_FRAMES = 1;
const DIRECT_TREADLES = 1;
const DRAFT_DIM_MIN = 1;
const DRAFT_DIM_MAX = 512;

function clampDraftDim(n: number): number {
  if (!Number.isFinite(n)) return DRAFT_DIM_MIN;
  return Math.min(DRAFT_DIM_MAX, Math.max(DRAFT_DIM_MIN, Math.floor(n)));
}

/** Parse a typed integer; empty/partial → null (don’t commit yet). */
function parseTypingInt(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Parse a typed decimal; empty/partial → null. */
function parseTypingFloat(raw: string): number | null {
  const t = raw.trim();
  if (t === '' || t === '.' || t === '-') return null;
  if (!/^\d*\.?\d*$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}


/** wefts / warps; clamped so division stays stable */
function safeDraftAspectRatio(r: number): number {
  if (!Number.isFinite(r) || r <= 0) return 1;
  const lo = DRAFT_DIM_MIN / DRAFT_DIM_MAX;
  const hi = DRAFT_DIM_MAX / DRAFT_DIM_MIN;
  return Math.min(hi, Math.max(lo, r));
}

/** ratio = wefts / warps */
function solveLockedFromWarps(rawW: number, ratio: number): { w: number; h: number } {
  const r = safeDraftAspectRatio(ratio);
  let w = clampDraftDim(rawW);
  let hIdeal = Math.round(w * r);
  let h = clampDraftDim(hIdeal);
  if (h !== hIdeal) {
    if (hIdeal > DRAFT_DIM_MAX) {
      h = DRAFT_DIM_MAX;
      w = clampDraftDim(Math.round(h / r));
    } else {
      h = DRAFT_DIM_MIN;
      w = clampDraftDim(Math.round(h / r));
    }
  }
  return { w, h };
}

/** ratio = wefts / warps */
function solveLockedFromWefts(rawH: number, ratio: number): { w: number; h: number } {
  const r = safeDraftAspectRatio(ratio);
  let h = clampDraftDim(rawH);
  let wIdeal = Math.round(h / r);
  let w = clampDraftDim(wIdeal);
  if (w !== wIdeal) {
    if (wIdeal > DRAFT_DIM_MAX) {
      w = DRAFT_DIM_MAX;
      h = clampDraftDim(Math.round(w * r));
    } else {
      w = DRAFT_DIM_MIN;
      h = clampDraftDim(Math.round(w * r));
    }
  }
  return { w, h };
}

/** Stretch/shrink the binary grid to target size (nearest-neighbor). */
function resizeGridNearest(
  grid: number[][],
  targetCols: number,
  targetRows: number
): number[][] {
  const srcRows = grid.length;
  const srcCols = grid[0]?.length ?? 0;
  if (targetCols < 1 || targetRows < 1) return [];
  if (srcRows === 0 || srcCols === 0) {
    return Array.from({ length: targetRows }, () =>
      Array(targetCols).fill(0)
    );
  }
  const out: number[][] = [];
  for (let y = 0; y < targetRows; y++) {
    const sy = Math.min(
      srcRows - 1,
      Math.floor(((y + 0.5) * srcRows) / targetRows)
    );
    const row: number[] = [];
    for (let x = 0; x < targetCols; x++) {
      const sx = Math.min(
        srcCols - 1,
        Math.floor(((x + 0.5) * srcCols) / targetCols)
      );
      row.push(grid[sy]?.[sx] ?? 0);
    }
    out.push(row);
  }
  return out;
}

function gridToDrawdown(grid: number[][]) {
  return grid.map((row) =>
    row.map((v) => ({ is_set: true, is_up: v === 1 }))
  );
}

/** Compare two drawdowns of equal size; returns number of cells where up/down differs. */
function drawdownMismatchCount(a: Drawdown, b: Drawdown): number | null {
  const w = warps(a);
  const h = wefts(a);
  if (warps(b) !== w || wefts(b) !== h) return null;
  let n = 0;
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
      if (isUp(a, i, j) !== isUp(b, i, j)) n++;
    }
  }
  return n;
}

function gridLinesSvg(
  cols: number,
  rows: number,
  cell: number,
  stroke: string
) {
  const lines: ReactNode[] = [];
  const w = cols * cell;
  const h = rows * cell;
  for (let c = 0; c <= cols; c++) {
    lines.push(
      <line
        key={`v-${c}`}
        x1={c * cell}
        y1={0}
        x2={c * cell}
        y2={h}
        stroke={stroke}
        strokeWidth={0.5}
      />
    );
  }
  for (let r = 0; r <= rows; r++) {
    lines.push(
      <line
        key={`h-${r}`}
        x1={0}
        y1={r * cell}
        x2={w}
        y2={r * cell}
        stroke={stroke}
        strokeWidth={0.5}
      />
    );
  }
  return lines;
}

function treadleColActive(treadleRow: number[] | undefined, ti: number): boolean {
  if (!treadleRow?.length) return false;
  const z = ti;
  const one = ti + 1;
  return treadleRow.some((x) => x === z || x === one);
}

/**
 * Classic drafting layout: threading | tie-up over drawdown | treadling.
 * Columns align (warps); treadling rows align with drawdown picks.
 */
function ClassicDraftView({
  loom,
  drawdown,
}: {
  loom: Loom;
  drawdown: Drawdown;
}) {
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  }>({
    dragging: false,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });

  const zoomOut = () => setZoom((z) => Math.max(0.5, Number((z - 0.1).toFixed(2))));
  const zoomIn = () => setZoom((z) => Math.min(4, Number((z + 0.1).toFixed(2))));
  const resetView = () => {
    setZoom(1);
    const el = scrollRef.current;
    if (el) {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    const drag = dragRef.current;
    if (!el || !drag.dragging) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    el.scrollLeft = drag.scrollLeft - dx;
    el.scrollTop = drag.scrollTop - dy;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current.dragging = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const nWarps = loom.threading.length;
  const nWefts = loom.treadling.length;
  const nShafts = loom.tieup.length;
  const nTreadles = loom.tieup[0]?.length ?? 0;

  if (
    nWarps === 0 ||
    nWefts === 0 ||
    nShafts === 0 ||
    nTreadles === 0 ||
    warps(drawdown) !== nWarps ||
    wefts(drawdown) !== nWefts
  ) {
    return (
      <p className="text-xs text-amber-600/90">
        Draft dimensions do not match loom data — try regenerating.
      </p>
    );
  }

  const gridStroke = 'var(--border, #c8c4bc)';
  const dotFill = '#3d3d3d';
  const lineDotR = 0.32;

  const tmin = Math.min(...loom.threading);
  const threadingOneBased = tmin >= 1;
  const threadingRowForWarp = (j: number) => {
    const s = loom.threading[j];
    return threadingOneBased ? nShafts - s : nShafts - 1 - s;
  };

  const bw = nWarps + nTreadles;
  const bh = nShafts + nWefts;
  const cell = Math.max(2, Math.min(14, Math.floor(520 / Math.max(bw, bh, 1))));

  const tw = nWarps * cell;
  const th = nShafts * cell;
  const uw = nTreadles * cell;
  const uh = nShafts * cell;
  const dw = nWarps * cell;
  const dh = nWefts * cell;
  const rw = nTreadles * cell;
  const rh = nWefts * cell;

  return (
    <div>
      <div className="mb-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
          Draft (threading · tie-up · drawdown · treadling)
        </h3>
      </div>
      <p className="mb-3 text-xs text-muted leading-relaxed">
        Same layout as standard drafting software: threading above the fabric,
        tie-up upper-right, treadling beside picks. Shaft 1 is the bottom row
        of the threading grid; top pick is row 0.
      </p>
      <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-muted">
        <span>Drag to pan, use +/- to zoom.</span>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={zoomOut}
            className="border border-border px-2 py-1 text-text hover:bg-border"
          >
            -
          </button>
          <span className="min-w-12 text-center text-muted">
            {Math.round(zoom * 100)}%
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
        ref={scrollRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="max-h-[min(78vh,720px)] overflow-auto overscroll-contain rounded border border-border bg-[#f7f5f0] p-2 cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'pan-x pan-y' }}
      >
        <div
          className="inline-block origin-top-left"
          style={{ transform: `scale(${zoom})` }}
        >
          <div className="inline-flex flex-col gap-px">
          <div className="inline-flex flex-row gap-px">
            <svg
              width={tw}
              height={th}
              className="block shrink-0"
              style={{ imageRendering: 'pixelated' }}
            >
              <rect width={tw} height={th} fill="#faf8f4" />
              {gridLinesSvg(nWarps, nShafts, cell, gridStroke)}
              {Array.from({ length: nShafts }, (_, r) =>
                Array.from({ length: nWarps }, (_, j) => {
                  if (threadingRowForWarp(j) !== r) return null;
                  const cx = j * cell + cell / 2;
                  const cy = r * cell + cell / 2;
                  return (
                    <circle
                      key={`t-${r}-${j}`}
                      cx={cx}
                      cy={cy}
                      r={cell * lineDotR}
                      fill={dotFill}
                    />
                  );
                })
              )}
            </svg>
            <svg
              width={uw}
              height={uh}
              className="block shrink-0"
              style={{ imageRendering: 'pixelated' }}
            >
              <rect width={uw} height={uh} fill="#faf8f4" />
              {gridLinesSvg(nTreadles, nShafts, cell, gridStroke)}
              {Array.from({ length: nShafts }, (_, r) =>
                Array.from({ length: nTreadles }, (_, ti) => {
                  const libRow = nShafts - 1 - r;
                  const on = loom.tieup[libRow]?.[ti];
                  if (!on) return null;
                  const cx = ti * cell + cell / 2;
                  const cy = r * cell + cell / 2;
                  return (
                    <circle
                      key={`u-${r}-${ti}`}
                      cx={cx}
                      cy={cy}
                      r={cell * lineDotR}
                      fill={dotFill}
                    />
                  );
                })
              )}
            </svg>
          </div>
          <div className="inline-flex flex-row gap-px">
            <svg
              width={dw}
              height={dh}
              className="block shrink-0"
              style={{ imageRendering: 'pixelated' }}
            >
              <rect width={dw} height={dh} fill="#faf8f4" />
              {gridLinesSvg(nWarps, nWefts, cell, gridStroke)}
              {Array.from({ length: nWefts }, (_, i) =>
                Array.from({ length: nWarps }, (_, j) => {
                  const set = isSet(drawdown, i, j);
                  const up = isUp(drawdown, i, j);
                  const fill = !set ? '#d4d0c8' : up ? '#1a1a1a' : '#f7f5f0';
                  return (
                    <rect
                      key={`d-${i}-${j}`}
                      x={j * cell}
                      y={i * cell}
                      width={cell}
                      height={cell}
                      fill={fill}
                    />
                  );
                })
              )}
            </svg>
            <svg
              width={rw}
              height={rh}
              className="block shrink-0"
              style={{ imageRendering: 'pixelated' }}
            >
              <rect width={rw} height={rh} fill="#faf8f4" />
              {gridLinesSvg(nTreadles, nWefts, cell, gridStroke)}
              {Array.from({ length: nWefts }, (_, i) =>
                Array.from({ length: nTreadles }, (_, ti) => {
                  const row = loom.treadling[i];
                  if (!treadleColActive(row, ti)) return null;
                  const cx = ti * cell + cell / 2;
                  const cy = i * cell + cell / 2;
                  return (
                    <circle
                      key={`tr-${i}-${ti}`}
                      cx={cx}
                      cy={cy}
                      r={cell * lineDotR}
                      fill={dotFill}
                    />
                  );
                })
              )}
            </svg>
          </div>
        </div>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        {nWarps} warps × {nWefts} wefts · {nShafts} shafts · {nTreadles}{' '}
        treadles · cell {cell}px
      </p>
    </div>
  );
}

function drawdownToDataUrl(drawdown: Drawdown): string {
  const cols = Math.max(1, warps(drawdown));
  const rows = Math.max(1, wefts(drawdown));
  const cell = Math.max(8, Math.floor(900 / Math.max(cols, rows)));
  const leftPad = 30;
  const topPad = 24;
  const bottomPad = 8;
  const rightPad = 8;
  const gridW = cols * cell;
  const gridH = rows * cell;
  const canvas = document.createElement('canvas');
  canvas.width = leftPad + gridW + rightPad;
  canvas.height = topPad + gridH + bottomPad;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#faf8f4';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (isUp(drawdown, i, j)) {
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(leftPad + j * cell, topPad + i * cell, cell, cell);
      }
    }
  }

  // Grid overlay with 5-cell cadence labels.
  for (let x = 0; x <= cols; x++) {
    const major = x % 5 === 0;
    ctx.strokeStyle = major ? 'rgba(0,0,0,0.24)' : 'rgba(0,0,0,0.10)';
    ctx.lineWidth = major ? 1.2 : 1;
    ctx.beginPath();
    ctx.moveTo(leftPad + x * cell + 0.5, topPad);
    ctx.lineTo(leftPad + x * cell + 0.5, topPad + gridH);
    ctx.stroke();
  }
  for (let y = 0; y <= rows; y++) {
    const major = y % 5 === 0;
    ctx.strokeStyle = major ? 'rgba(0,0,0,0.24)' : 'rgba(0,0,0,0.10)';
    ctx.lineWidth = major ? 1.2 : 1;
    ctx.beginPath();
    ctx.moveTo(leftPad, topPad + y * cell + 0.5);
    ctx.lineTo(leftPad + gridW, topPad + y * cell + 0.5);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.font = `${Math.max(10, Math.floor(cell * 0.55))}px "IBM Plex Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let x = 5; x <= cols; x += 5) {
    ctx.fillText(String(x), leftPad + x * cell, Math.max(8, topPad / 2));
  }
  ctx.textAlign = 'right';
  for (let y = 5; y <= rows; y += 5) {
    ctx.fillText(String(y), leftPad - 6, topPad + y * cell);
  }

  return canvas.toDataURL('image/png');
}

export function WeaveModal({
  open,
  pieces,
  onSaveToLibrary,
  initialSelectedId,
  editPieceId,
  onClose,
}: WeaveModalProps) {
  const [selectedId, setSelectedId] = useState<string>('');
  const [epi, setEpi] = useState(12);
  const [ppi, setPpi] = useState(12);
  const [units, setUnits] = useState<LoomSettings['units']>('in');
  const [loom, setLoom] = useState<Loom | null>(null);
  const [drawdown, setDrawdown] = useState<Drawdown | null>(null);
  const [dims, setDims] = useState<{ warps: number; wefts: number } | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recomputeTick, setRecomputeTick] = useState(0);
  const [roundTrip, setRoundTrip] = useState<Drawdown | null>(null);
  const [roundTripLoading, setRoundTripLoading] = useState(false);
  const [draftWarps, setDraftWarps] = useState(80);
  const [draftWefts, setDraftWefts] = useState(80);
  const [sourceDims, setSourceDims] = useState<{
    warps: number;
    wefts: number;
  } | null>(null);
  /** When set, last draft targets synced to this piece id (avoids stale draft dims after piece change). */
  const draftBaselineRef = useRef<{
    id: string;
    warps: number;
    wefts: number;
  } | null>(null);
  /** wefts / warps while “lock ratio” is on */
  const draftAspectRatioRef = useRef(1);
  const [lockDraftRatio, setLockDraftRatio] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [debouncedWarps, setDebouncedWarps] = useState(80);
  const [debouncedWefts, setDebouncedWefts] = useState(80);
  /** String buffers so clearing/retyping doesn’t clamp mid-keystroke. */
  const [warpsText, setWarpsText] = useState('80');
  const [weftsText, setWeftsText] = useState('80');
  const [epiText, setEpiText] = useState('12');
  const [ppiText, setPpiText] = useState('12');
  const draftCaptureRef = useRef<HTMLDivElement | null>(null);
  const lastDimEditRef = useRef<'warps' | 'wefts'>('warps');
  const requestCloseRef = useRef<() => void>(() => {});
  const handleSaveRef = useRef<() => Promise<void>>(async () => {});

  const sortedPieces = useMemo(() => {
    const preferred = pieces.filter(isPreferredWeaveSource);
    const other = pieces.filter((p) => !isPreferredWeaveSource(p));
    return [...preferred, ...other];
  }, [pieces]);

  const preferredPieces = useMemo(
    () => pieces.filter(isPreferredWeaveSource),
    [pieces]
  );

  const selectedPiece = pieces.find((p) => p.id === selectedId) ?? null;
  const editingPiece = editPieceId
    ? pieces.find((p) => p.id === editPieceId) ?? null
    : null;

  const commitWarps = (raw: number) => {
    setDirty(true);
    if (lockDraftRatio) {
      const { w, h } = solveLockedFromWarps(raw, draftAspectRatioRef.current);
      setDraftWarps(w);
      setDraftWefts(h);
      setWarpsText(String(w));
      setWeftsText(String(h));
    } else {
      const w = clampDraftDim(raw);
      setDraftWarps(w);
      setWarpsText(String(w));
    }
  };

  const commitWefts = (raw: number) => {
    setDirty(true);
    if (lockDraftRatio) {
      const { w, h } = solveLockedFromWefts(raw, draftAspectRatioRef.current);
      setDraftWarps(w);
      setDraftWefts(h);
      setWarpsText(String(w));
      setWeftsText(String(h));
    } else {
      const h = clampDraftDim(raw);
      setDraftWefts(h);
      setWeftsText(String(h));
    }
  };

  const onWarpsTextChange = (raw: string) => {
    setDirty(true);
    lastDimEditRef.current = 'warps';
    setWarpsText(raw);
  };

  const onWeftsTextChange = (raw: string) => {
    setDirty(true);
    lastDimEditRef.current = 'wefts';
    setWeftsText(raw);
  };

  const onWarpsBlur = () => {
    const n = parseTypingInt(warpsText);
    commitWarps(n == null ? draftWarps : n);
  };

  const onWeftsBlur = () => {
    const n = parseTypingInt(weftsText);
    commitWefts(n == null ? draftWefts : n);
  };

  const onEpiTextChange = (raw: string) => {
    setDirty(true);
    setEpiText(raw);
  };

  const onPpiTextChange = (raw: string) => {
    setDirty(true);
    setPpiText(raw);
  };

  const onEpiBlur = () => {
    const n = parseTypingFloat(epiText);
    const next = n != null && n > 0 ? n : epi;
    setEpi(next);
    setEpiText(String(next));
  };

  const onPpiBlur = () => {
    const n = parseTypingFloat(ppiText);
    const next = n != null && n > 0 ? n : ppi;
    setPpi(next);
    setPpiText(String(next));
  };

  // Commit typed dims after a pause (skip empty/partial), then feed loom recompute.
  useEffect(() => {
    const id = setTimeout(() => {
      const w = parseTypingInt(warpsText);
      const h = parseTypingInt(weftsText);
      if (lockDraftRatio) {
        if (lastDimEditRef.current === 'warps' && w != null) {
          const solved = solveLockedFromWarps(w, draftAspectRatioRef.current);
          setDraftWarps(solved.w);
          setDraftWefts(solved.h);
          if (String(solved.h) !== weftsText) setWeftsText(String(solved.h));
          setDebouncedWarps(solved.w);
          setDebouncedWefts(solved.h);
        } else if (lastDimEditRef.current === 'wefts' && h != null) {
          const solved = solveLockedFromWefts(h, draftAspectRatioRef.current);
          setDraftWarps(solved.w);
          setDraftWefts(solved.h);
          if (String(solved.w) !== warpsText) setWarpsText(String(solved.w));
          setDebouncedWarps(solved.w);
          setDebouncedWefts(solved.h);
        }
        return;
      }
      if (w != null) {
        const cw = clampDraftDim(w);
        setDraftWarps(cw);
        setDebouncedWarps(cw);
      }
      if (h != null) {
        const ch = clampDraftDim(h);
        setDraftWefts(ch);
        setDebouncedWefts(ch);
      }
    }, 320);
    return () => clearTimeout(id);
  }, [warpsText, weftsText, lockDraftRatio]);

  // Live EPI/PPI while typing valid decimals (size readout only; no loom recompute).
  useEffect(() => {
    const id = setTimeout(() => {
      const e = parseTypingFloat(epiText);
      const p = parseTypingFloat(ppiText);
      if (e != null && e > 0) setEpi(e);
      if (p != null && p > 0) setPpi(p);
    }, 160);
    return () => clearTimeout(id);
  }, [epiText, ppiText]);

  const loomSettings: LoomSettings = useMemo(
    () => ({
      type: 'direct',
      epi,
      ppi,
      units,
      frames: DIRECT_FRAMES,
      treadles: DIRECT_TREADLES,
    }),
    [epi, ppi, units]
  );

  const draft = useMemo(
    () => (drawdown ? initDraftFromDrawdown(drawdown) : null),
    [drawdown]
  );

  const dressingRows = useMemo(() => {
    if (!drawdown || !loom) return [];
    return direct_utils.getDressingInfo(drawdown, loom, loomSettings);
  }, [drawdown, loom, loomSettings]);

  const physicalWidth = drawdown ? calcWidth(drawdown, loomSettings) : null;
  const physicalLength = drawdown ? calcLength(drawdown, loomSettings) : null;

  const framesUsed = loom ? numFrames(loom) : null;
  const treadlesUsed = loom ? numTreadles(loom) : null;

  const roundTripMismatch =
    drawdown && roundTrip ? drawdownMismatchCount(drawdown, roundTrip) : null;

  useEffect(() => {
    if (!open) return;
    setDirty(false);
    setSaveError(null);
    setSaveSuccess(null);
    setExportNote(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (selectedId) return;
    const first =
      preferredPieces[0]?.id ?? sortedPieces[0]?.id ?? pieces[0]?.id ?? '';
    if (first) setSelectedId(first);
  }, [open, pieces, preferredPieces, sortedPieces, selectedId]);

  useEffect(() => {
    if (!open) return;
    if (!initialSelectedId) return;
    const exists = pieces.some((p) => p.id === initialSelectedId);
    if (exists) {
      setSelectedId(initialSelectedId);
    }
  }, [open, initialSelectedId, pieces]);

  useEffect(() => {
    if (!loom) {
      setRoundTrip(null);
      return;
    }
    let cancelled = false;
    setRoundTripLoading(true);
    computeDrawdown(loom)
      .then((d) => {
        if (!cancelled) setRoundTrip(d);
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setRoundTrip(null);
      })
      .finally(() => {
        if (!cancelled) setRoundTripLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loom]);

  useEffect(() => {
    if (!open || !selectedPiece) {
      setLoom(null);
      setDrawdown(null);
      setDims(null);
      setSourceDims(null);
      draftBaselineRef.current = null;
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const bitmapPreview = await getPreviewAsync({
          ...selectedPiece,
          type: 'bitmap',
        });
        if (cancelled) return;
        if (bitmapPreview.type !== 'bitmap') {
          throw new Error('Could not build bitmap preview for this piece.');
        }
        const srcW = bitmapPreview.cols;
        const srcH = bitmapPreview.rows;
        setSourceDims({ warps: srcW, wefts: srcH });

        const baseline = draftBaselineRef.current;
        const pieceSwitched = !baseline || baseline.id !== selectedPiece.id;

        let wTarget: number;
        let hTarget: number;
        if (pieceSwitched) {
          wTarget = srcW;
          hTarget = srcH;
          draftBaselineRef.current = {
            id: selectedPiece.id,
            warps: srcW,
            wefts: srcH,
          };
          setDraftWarps(srcW);
          setDraftWefts(srcH);
          setWarpsText(String(srcW));
          setWeftsText(String(srcH));
          if (lockDraftRatio && srcW >= 1) {
            draftAspectRatioRef.current = safeDraftAspectRatio(srcH / srcW);
          }
        } else {
          wTarget = clampDraftDim(debouncedWarps);
          hTarget = clampDraftDim(debouncedWefts);
        }

        const resized = resizeGridNearest(bitmapPreview.grid, wTarget, hTarget);
        const dd = gridToDrawdown(resized);
        setDims({ warps: wTarget, wefts: hTarget });
        setDrawdown(dd);

        if (!direct_utils.computeLoomFromDrawdown) {
          throw new Error('Direct loom utilities not available.');
        }
        const settingsForCompute: LoomSettings = {
          type: 'direct',
          epi,
          ppi,
          units,
          frames: DIRECT_FRAMES,
          treadles: DIRECT_TREADLES,
        };
        const result = await direct_utils.computeLoomFromDrawdown(
          dd,
          settingsForCompute
        );
        if (!cancelled) setLoom(result);
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoom(null);
          setDrawdown(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- epi/ppi/units/lockDraftRatio omitted: density edits must not refetch; lock toggle must not refetch; lockDraftRatio is read when piece switches
  }, [open, selectedPiece, recomputeTick, debouncedWarps, debouncedWefts]);

  const requestClose = () => {
    if (saveLoading) return;
    if (
      dirty &&
      !window.confirm('Discard unsaved weave changes?')
    ) {
      return;
    }
    onClose();
  };

  const copyLoomJson = () => {
    if (!loom || !drawdown || !selectedPiece) return;
    const payload = {
      format: 'adacad-weave-export',
      version: 1,
      piece: { id: selectedPiece.id, title: selectedPiece.title },
      loomSettings,
      draft: draft
        ? {
            id: draft.id,
            name: getDraftName(draft),
            gen_name: draft.gen_name,
            ud_name: draft.ud_name,
          }
        : null,
      drawdownSize: { warps: warps(drawdown), wefts: wefts(drawdown) },
      loom: {
        threading: loom.threading,
        tieup: loom.tieup,
        treadling: loom.treadling,
      },
      dressing: dressingRows,
      physical:
        physicalWidth != null && physicalLength != null
          ? {
              width: physicalWidth,
              length: physicalLength,
              units: loomSettings.units,
            }
          : null,
      verify:
        roundTrip != null
          ? {
              roundTripSize: {
                warps: warps(roundTrip),
                wefts: wefts(roundTrip),
              },
              cellMismatchesVsSource: roundTripMismatch,
            }
          : null,
    };
    void navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(
      () => {
        setExportNote('Loom JSON copied.');
        setTimeout(() => setExportNote(null), 1500);
      }
    );
  };

  const downloadDressingList = () => {
    if (!loom || !selectedPiece) return;
    const safe = selectedPiece.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    downloadTextFile(
      `${safe || 'weave'}_dressing.txt`,
      formatDressingList(loom, selectedPiece.title)
    );
    setExportNote('Dressing list downloaded.');
    setTimeout(() => setExportNote(null), 1500);
  };

  const downloadDraftPng = async () => {
    if (!loom || !drawdown || !selectedPiece) return;
    const safe = selectedPiece.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    try {
      if (draftCaptureRef.current) {
        const canvas = await html2canvas(draftCaptureRef.current, {
          backgroundColor: '#f7f5f0',
          scale: 2,
        });
        downloadDataUrl(`${safe || 'weave'}_draft.png`, canvas.toDataURL('image/png'));
      } else {
        const dataUrl = drawdownToDataUrl(drawdown);
        if (!dataUrl) throw new Error('Could not render draft image.');
        downloadDataUrl(`${safe || 'weave'}_draft.png`, dataUrl);
      }
      setExportNote('Draft PNG downloaded.');
      setTimeout(() => setExportNote(null), 1500);
    } catch (e) {
      console.error(e);
      setExportNote('PNG export failed.');
      setTimeout(() => setExportNote(null), 2000);
    }
  };

  const handleSaveToLibrary = async () => {
    if (!selectedPiece || !drawdown || saveLoading) return;
    setSaveError(null);
    setSaveSuccess(null);
    setSaveLoading(true);
    try {
      const cols = warps(drawdown);
      const rows = wefts(drawdown);
      const dataUrl = drawdownToDataUrl(drawdown);
      if (!dataUrl) {
        throw new Error('Could not serialize draft image for saving.');
      }
      const nextPiece: Piece = {
        id: editingPiece?.id ?? crypto.randomUUID(),
        title: editingPiece?.title ?? selectedPiece.title,
        description: `Weave draft generated from "${selectedPiece.title}" (${cols} warps × ${rows} wefts).`,
        author: editingPiece?.author ?? selectedPiece.author,
        pieceKind: 'weave',
        weaveWarps: cols,
        weaveWefts: rows,
        dateAdded: editingPiece?.dateAdded ?? new Date().toISOString(),
        type: 'bitmap',
        inputType: 'image',
        inputImageDataURL: dataUrl,
        gridCols: cols,
        invert: false,
        threshold: 128,
        showPreviewGrid: true,
        includeGridInSavedImage: false,
      };
      await onSaveToLibrary(nextPiece);
      setDirty(false);
      setSaveSuccess('Saved to library.');
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaveLoading(false);
    }
  };

  requestCloseRef.current = requestClose;
  handleSaveRef.current = handleSaveToLibrary;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        requestCloseRef.current();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void handleSaveRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  const canExport = Boolean(loom && drawdown && !loading);
  const selectedIsPreferred = selectedPiece
    ? isPreferredWeaveSource(selectedPiece)
    : false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/30 font-sans"
      onClick={(e) => e.target === e.currentTarget && requestClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Weave"
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden border border-border bg-bg-card shadow-xl lg:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: piece + primary actions */}
        <div className="flex w-full shrink-0 flex-col border-b border-border lg:w-[300px] lg:border-b-0 lg:border-r">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
            <div>
              <h2 className="text-lg font-normal text-text">Weave</h2>
              <p className="mt-1 text-xs text-muted leading-relaxed">
                Direct tie-up dressing from a binary grid for hand weaving on a
                shaft loom.{' '}
                <a
                  href="https://docs.adacad.org/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent underline"
                >
                  AdaCAD docs
                </a>
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm text-muted">Piece</label>
              <select
                value={selectedId}
                onChange={(e) => {
                  setSelectedId(e.target.value);
                  setDirty(true);
                }}
                className="w-full border border-border bg-bg-card px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              >
                {sortedPieces.length === 0 ? (
                  <option value="">No pieces yet</option>
                ) : (
                  <>
                    {preferredPieces.length > 0 && (
                      <optgroup label="Binary / pattern">
                        {preferredPieces.map((p) => (
                          <option key={p.id} value={p.id}>
                            {pieceOptionLabel(p)}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {sortedPieces.some((p) => !isPreferredWeaveSource(p)) && (
                      <optgroup label="Other (via bitmap)">
                        {sortedPieces
                          .filter((p) => !isPreferredWeaveSource(p))
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {pieceOptionLabel(p)}
                            </option>
                          ))}
                      </optgroup>
                    )}
                  </>
                )}
              </select>
              {selectedPiece && !selectedIsPreferred && (
                <p className="mt-1 text-[11px] text-muted">
                  Converted via bitmap preview — binary/pattern pieces work best.
                </p>
              )}
              {pieces.length === 0 && (
                <p className="mt-2 text-xs text-muted">
                  Create a binary or pattern piece first, then open Weave.
                </p>
              )}
            </div>

            {loom && (
              <p className="border border-border bg-bg px-3 py-2 text-xs text-text">
                Needs{' '}
                <strong>{framesUsed ?? '—'}</strong> frames ·{' '}
                <strong>{treadlesUsed ?? '—'}</strong> treadles
              </p>
            )}
          </div>

          <div className="sticky bottom-0 flex flex-col gap-2 border-t border-border bg-bg-card px-5 py-3">
            <button
              type="button"
              onClick={handleSaveToLibrary}
              disabled={!canExport || saveLoading}
              className="border border-accent bg-bg-card px-4 py-2 text-sm font-medium text-accent disabled:opacity-50 hover:bg-border"
            >
              {saveLoading
                ? 'Saving…'
                : editingPiece
                  ? 'Update weave'
                  : 'Save to library'}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={copyLoomJson}
                disabled={!canExport}
                className="border border-border px-3 py-2 text-xs text-text disabled:opacity-50 hover:bg-border"
              >
                Copy JSON
              </button>
              <button
                type="button"
                onClick={() => void downloadDraftPng()}
                disabled={!canExport}
                className="border border-border px-3 py-2 text-xs text-text disabled:opacity-50 hover:bg-border"
              >
                Draft PNG
              </button>
              <button
                type="button"
                onClick={downloadDressingList}
                disabled={!canExport}
                className="col-span-2 border border-border px-3 py-2 text-xs text-text disabled:opacity-50 hover:bg-border"
              >
                Download dressing list
              </button>
            </div>
            <button
              type="button"
              onClick={requestClose}
              disabled={saveLoading}
              className="border border-border px-4 py-2 text-sm text-muted hover:bg-border hover:text-text"
            >
              Close
            </button>
            {saveError && <p className="text-xs text-red-400">{saveError}</p>}
            {saveSuccess && (
              <p className="text-xs text-emerald-600">{saveSuccess}</p>
            )}
            {exportNote && <p className="text-xs text-muted">{exportNote}</p>}
          </div>
        </div>

        {/* Middle: draft size + density */}
        <div className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto overscroll-contain border-b border-border p-5 lg:w-[300px] lg:border-b-0 lg:border-r">
          <h3 className="text-sm font-medium text-text">Draft size</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-muted">
                Warps (ends)
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                min={DRAFT_DIM_MIN}
                max={DRAFT_DIM_MAX}
                value={warpsText}
                onChange={(e) => onWarpsTextChange(e.target.value)}
                onBlur={onWarpsBlur}
                disabled={!selectedPiece}
                className="w-full border border-border bg-bg-card px-3 py-2 text-sm text-text focus:border-accent focus:outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted">
                Wefts (picks)
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                min={DRAFT_DIM_MIN}
                max={DRAFT_DIM_MAX}
                value={weftsText}
                onChange={(e) => onWeftsTextChange(e.target.value)}
                onBlur={onWeftsBlur}
                disabled={!selectedPiece}
                className="w-full border border-border bg-bg-card px-3 py-2 text-sm text-text focus:border-accent focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              className="accent-accent"
              checked={lockDraftRatio}
              onChange={(e) => {
                const on = e.target.checked;
                setLockDraftRatio(on);
                if (on && draftWarps >= 1) {
                  draftAspectRatioRef.current = safeDraftAspectRatio(
                    draftWefts / draftWarps
                  );
                }
              }}
              disabled={!selectedPiece}
            />
            <span>Lock warp/weft ratio</span>
          </label>
          {lockDraftRatio && draftWarps >= 1 && (
            <p className="text-[11px] text-muted">
              Ratio (wefts ÷ warps): {(draftWefts / draftWarps).toFixed(4)}
            </p>
          )}
          {sourceDims && (
            <p className="text-xs text-muted leading-relaxed">
              Source {sourceDims.warps} × {sourceDims.wefts}. Resamples with
              nearest-neighbor.{' '}
              <button
                type="button"
                disabled={!selectedPiece}
                onClick={() => {
                  setDirty(true);
                  setDraftWarps(sourceDims.warps);
                  setDraftWefts(sourceDims.wefts);
                  setWarpsText(String(sourceDims.warps));
                  setWeftsText(String(sourceDims.wefts));
                  if (lockDraftRatio) {
                    draftAspectRatioRef.current = safeDraftAspectRatio(
                      sourceDims.wefts / sourceDims.warps
                    );
                  }
                }}
                className="text-accent underline disabled:opacity-50"
              >
                Reset to piece size
              </button>
            </p>
          )}

          <h3 className="pt-2 text-sm font-medium text-text">Density</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-muted">EPI</label>
              <input
                type="text"
                inputMode="decimal"
                value={epiText}
                onChange={(e) => onEpiTextChange(e.target.value)}
                onBlur={onEpiBlur}
                className="w-full border border-border bg-bg-card px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted">PPI</label>
              <input
                type="text"
                inputMode="decimal"
                value={ppiText}
                onChange={(e) => onPpiTextChange(e.target.value)}
                onBlur={onPpiBlur}
                className="w-full border border-border bg-bg-card px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted">Units</label>
            <select
              value={units}
              onChange={(e) => {
                setDirty(true);
                setUnits(e.target.value as LoomSettings['units']);
              }}
              className="w-full border border-border bg-bg-card px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
            >
              <option value="in">inches</option>
              <option value="cm">cm</option>
            </select>
          </div>
          <p className="border border-border bg-bg px-3 py-2 text-xs text-text">
            Cloth size (live){' '}
            {physicalWidth != null && physicalLength != null ? (
              <>
                ≈ <strong>{physicalWidth.toFixed(2)}</strong> ×{' '}
                <strong>{physicalLength.toFixed(2)}</strong>
                {units === 'in' ? ' in' : ' cm'}
              </>
            ) : (
              <span className="text-muted">—</span>
            )}
          </p>
          <p className="text-[11px] text-muted">
            EPI / PPI update size immediately. Warp / weft changes recompute the
            loom after a short pause.
          </p>
          <button
            type="button"
            onClick={() => {
              setDirty(true);
              setRecomputeTick((n) => n + 1);
            }}
            disabled={!selectedPiece || loading}
            className="border border-border px-4 py-2 text-sm text-text disabled:opacity-50 hover:bg-border"
          >
            Regenerate loom
          </button>
        </div>

        {/* Right: draft view */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-sm text-muted">
            <span>
              Classic draft
              {dims && ` — ${dims.warps} ends × ${dims.wefts} picks`}
            </span>
            {loading && <span className="text-xs">Computing…</span>}
          </div>
          <div className="relative flex-1 overflow-auto bg-bg p-4 text-sm">
            {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
            {!selectedPiece && (
              <div className="flex h-full min-h-[200px] items-center justify-center border border-dashed border-border bg-bg-card p-6 text-center">
                <p className="max-w-sm text-sm text-muted">
                  Select a binary or pattern piece to generate a direct tie-up
                  draft.
                </p>
              </div>
            )}
            {selectedPiece && loading && !loom && (
              <div className="flex h-full min-h-[200px] items-center justify-center border border-border bg-bg-card p-6">
                <p className="animate-pulse text-sm text-muted">
                  Computing loom…
                </p>
              </div>
            )}
            {loom && drawdown && (
              <div
                className={`space-y-4 ${loading ? 'opacity-50 transition-opacity' : ''}`}
              >
                <div ref={draftCaptureRef}>
                  <ClassicDraftView loom={loom} drawdown={drawdown} />
                </div>

                <details className="border border-border bg-bg-card">
                  <summary className="cursor-pointer px-4 py-2 text-sm text-text">
                    Details
                  </summary>
                  <div className="space-y-4 border-t border-border px-4 py-3 text-xs">
                    {draft && (
                      <section>
                        <h3 className="mb-2 font-medium uppercase tracking-wide text-muted">
                          Draft (AdaCAD)
                        </h3>
                        <dl className="space-y-1 text-text">
                          <div className="flex justify-between gap-4">
                            <dt className="text-muted">Name</dt>
                            <dd className="text-right font-medium">
                              {getDraftName(draft)}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-4">
                            <dt className="text-muted">Draft id</dt>
                            <dd className="font-mono text-[11px]">{draft.id}</dd>
                          </div>
                          <div className="flex justify-between gap-4">
                            <dt className="text-muted">Drawdown</dt>
                            <dd>
                              {warps(draft.drawdown)} × {wefts(draft.drawdown)}
                            </dd>
                          </div>
                        </dl>
                      </section>
                    )}

                    <section>
                      <h3 className="mb-2 font-medium uppercase tracking-wide text-muted">
                        Dressing summary
                      </h3>
                      {dressingRows.length === 0 ? (
                        <p className="text-muted">No dressing rows returned.</p>
                      ) : (
                        <dl className="space-y-1 text-text">
                          {dressingRows.map((row) => (
                            <div
                              key={row.label}
                              className="flex justify-between gap-4"
                            >
                              <dt className="shrink-0 text-muted">{row.label}</dt>
                              <dd className="text-right">{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </section>

                    <section>
                      <h3 className="mb-2 font-medium uppercase tracking-wide text-muted">
                        Round-trip check
                      </h3>
                      {roundTripLoading && (
                        <p className="text-muted">Recomputing drawdown…</p>
                      )}
                      {!roundTripLoading && roundTrip && dims && (
                        <div className="space-y-1 text-text">
                          <p>
                            {warps(roundTrip)} × {wefts(roundTrip)} vs source{' '}
                            {dims.warps} × {dims.wefts}
                          </p>
                          {roundTripMismatch === null ? (
                            <p className="text-amber-600/90">
                              Sizes differ — compare skipped.
                            </p>
                          ) : roundTripMismatch === 0 ? (
                            <p className="text-emerald-600/90">
                              All cells match.
                            </p>
                          ) : (
                            <p className="text-amber-600/90">
                              {roundTripMismatch} cell(s) differ.
                            </p>
                          )}
                        </div>
                      )}
                      {!roundTripLoading && !roundTrip && (
                        <p className="text-muted">Could not compute round-trip.</p>
                      )}
                    </section>

                    <section>
                      <h3 className="mb-2 font-medium uppercase tracking-wide text-muted">
                        Raw threading / treadling
                      </h3>
                      <div className="space-y-3 text-muted">
                        <div>
                          <p className="mb-1 font-medium text-text">Threading</p>
                          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">
                            {loom.threading.join(', ')}
                          </pre>
                        </div>
                        <div>
                          <p className="mb-1 font-medium text-text">Treadling</p>
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-text">
                            {loom.treadling
                              .map((row, i) => `${i}: [${row.join(', ')}]`)
                              .join('\n')}
                          </pre>
                        </div>
                      </div>
                    </section>
                  </div>
                </details>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
