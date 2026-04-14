import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
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

interface WeaveModalProps {
  open: boolean;
  pieces: Piece[];
  onClose: () => void;
}

const DEFAULT_MAX_SHAFTS = 8;
const DRAFT_DIM_MIN = 1;
const DRAFT_DIM_MAX = 512;

function clampDraftDim(n: number): number {
  if (!Number.isFinite(n)) return DRAFT_DIM_MIN;
  return Math.min(DRAFT_DIM_MAX, Math.max(DRAFT_DIM_MIN, Math.floor(n)));
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
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
        Draft (threading · tie-up · drawdown · treadling)
      </h3>
      <p className="mb-3 text-xs text-muted leading-relaxed">
        Same layout as standard drafting software: threading above the fabric,
        tie-up upper-right, treadling beside picks. Shaft 1 is the bottom row
        of the threading grid; top pick is row 0.
      </p>
      <div className="max-h-[min(78vh,720px)] overflow-auto rounded border border-border bg-[#f7f5f0] p-2">
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
      <p className="mt-2 text-[11px] text-muted">
        {nWarps} warps × {nWefts} wefts · {nShafts} shafts · {nTreadles}{' '}
        treadles · cell {cell}px
      </p>
    </div>
  );
}

export function WeaveModal({ open, pieces, onClose }: WeaveModalProps) {
  const [selectedId, setSelectedId] = useState<string>('');
  const [maxShafts, setMaxShafts] = useState(DEFAULT_MAX_SHAFTS);
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

  const selectedPiece = pieces.find((p) => p.id === selectedId) ?? null;

  const onDraftWarpsInput = (raw: number) => {
    if (lockDraftRatio) {
      const { w, h } = solveLockedFromWarps(raw, draftAspectRatioRef.current);
      setDraftWarps(w);
      setDraftWefts(h);
    } else {
      setDraftWarps(clampDraftDim(raw));
    }
  };

  const onDraftWeftsInput = (raw: number) => {
    if (lockDraftRatio) {
      const { w, h } = solveLockedFromWefts(raw, draftAspectRatioRef.current);
      setDraftWarps(w);
      setDraftWefts(h);
    } else {
      setDraftWefts(clampDraftDim(raw));
    }
  };

  const loomSettings: LoomSettings = useMemo(
    () => ({
      type: 'direct',
      epi,
      ppi,
      units,
      frames: maxShafts,
      treadles: maxShafts,
    }),
    [epi, ppi, units, maxShafts]
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
    if (pieces.length && !selectedId) {
      setSelectedId(pieces[0].id);
    }
  }, [open, pieces, selectedId]);

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
          if (lockDraftRatio && srcW >= 1) {
            draftAspectRatioRef.current = safeDraftAspectRatio(srcH / srcW);
          }
        } else {
          wTarget = clampDraftDim(draftWarps);
          hTarget = clampDraftDim(draftWefts);
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
          frames: maxShafts,
          treadles: maxShafts,
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
  }, [open, selectedPiece, maxShafts, recomputeTick, draftWarps, draftWefts]);

  if (!open) return null;

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
    void navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 font-sans"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden border border-border bg-bg-card shadow-xl lg:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-full flex-col gap-4 overflow-y-auto border-b border-border p-6 lg:w-[380px] lg:border-b-0 lg:border-r">
          <h2 className="text-lg font-normal text-text">Weave (hand loom)</h2>
          <p className="text-xs text-muted leading-relaxed">
            For <strong className="text-text">hand weaving</strong> on a shaft
            loom: this turns your piece’s <strong className="text-text">binary</strong>{' '}
            grid into a{' '}
            <strong className="text-text">direct tie-up</strong> dressing —{' '}
            threading, tie-up, and treadling you can lift by treadle on the
            floor. No jacquard or TC2 output. Powered by{' '}
            <code className="text-text">adacad-drafting-lib</code>
            {' '}(see{' '}
            <a
              href="https://docs.adacad.org/"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              AdaCAD docs
            </a>
            ).
          </p>

          <div>
            <label className="mb-1 block text-sm text-muted">
              Piece
            </label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full border border-border bg-bg-card px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
            >
              {pieces.length === 0 ? (
                <option value="">No pieces yet</option>
              ) : (
                pieces.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                    {p.author ? ` — ${p.author}` : ''}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-muted">
                Warps (ends)
              </label>
              <input
                type="number"
                min={DRAFT_DIM_MIN}
                max={DRAFT_DIM_MAX}
                value={draftWarps}
                onChange={(e) =>
                  onDraftWarpsInput(Number(e.target.value))
                }
                disabled={!selectedPiece || loading}
                className="w-full border border-border bg-bg-card px-3 py-2 text-sm text-text focus:border-accent focus:outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted">
                Wefts (picks)
              </label>
              <input
                type="number"
                min={DRAFT_DIM_MIN}
                max={DRAFT_DIM_MAX}
                value={draftWefts}
                onChange={(e) =>
                  onDraftWeftsInput(Number(e.target.value))
                }
                disabled={!selectedPiece || loading}
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
              disabled={!selectedPiece || loading}
            />
            <span>Lock warp/weft ratio</span>
          </label>
          {lockDraftRatio && draftWarps >= 1 && (
            <p className="text-[11px] text-muted">
              Ratio (wefts ÷ warps):{' '}
              {(draftWefts / draftWarps).toFixed(4)}
            </p>
          )}
          {sourceDims && (
            <p className="text-xs text-muted leading-relaxed">
              Piece preview is {sourceDims.warps} × {sourceDims.wefts}. Changing
              warps/wefts resamples that pattern (nearest-neighbor).{' '}
              <button
                type="button"
                disabled={!selectedPiece || loading}
                onClick={() => {
                  setDraftWarps(sourceDims.warps);
                  setDraftWefts(sourceDims.wefts);
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

          <div>
            <label className="mb-1 block text-sm text-muted">
              Max shafts / treadles (direct tie-up): {maxShafts}
            </label>
            <input
              type="range"
              min={1}
              max={30}
              value={maxShafts}
              onChange={(e) => setMaxShafts(Number(e.target.value))}
              className="w-full accent-accent"
            />
            <p className="mt-1 text-xs text-muted">
              Caps at 30. The library expands the direct tie-up to at least this
              many frames and treadles.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-muted">EPI</label>
              <input
                type="number"
                min={1}
                step={0.1}
                value={epi}
                onChange={(e) => setEpi(Number(e.target.value) || 1)}
                className="w-full border border-border bg-bg-card px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted">PPI</label>
              <input
                type="number"
                min={1}
                step={0.1}
                value={ppi}
                onChange={(e) => setPpi(Number(e.target.value) || 1)}
                className="w-full border border-border bg-bg-card px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted">Units (for size)</label>
            <select
              value={units}
              onChange={(e) =>
                setUnits(e.target.value as LoomSettings['units'])
              }
              className="w-full border border-border bg-bg-card px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
            >
              <option value="in">inches</option>
              <option value="cm">cm</option>
            </select>
            <p className="mt-1 text-xs text-muted">
              Used for dressing notes and width/length estimates from the
              drawdown; does not change threading or treadling.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setRecomputeTick((n) => n + 1)}
            disabled={!selectedPiece || loading}
            className="border border-accent bg-bg-card px-4 py-2 text-sm font-medium text-accent disabled:opacity-50 hover:bg-border"
          >
            Regenerate loom
          </button>

          <button
            type="button"
            onClick={copyLoomJson}
            disabled={!loom || !drawdown || loading}
            className="border border-border bg-bg-card px-4 py-2 text-sm text-text disabled:opacity-50 hover:bg-border"
          >
            Copy loom JSON
          </button>

          <button
            type="button"
            onClick={onClose}
            className="border border-border px-4 py-2 text-sm text-text hover:bg-border"
          >
            Close
          </button>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden border-t border-border lg:border-t-0 lg:border-l-0">
          <div className="border-b border-border px-4 py-2 text-sm text-muted">
            Classic draft layout
            {dims &&
              ` — ${dims.warps} ends × ${dims.wefts} picks (from binary preview)`}
          </div>
          <div className="flex-1 overflow-auto bg-bg p-4 text-sm">
            {error && (
              <p className="mb-2 text-sm text-red-400">{error}</p>
            )}
            {!selectedPiece && (
              <p className="text-muted">Select a piece to generate a loom.</p>
            )}
            {loading && <p className="text-muted">Computing loom…</p>}
            {loom && !loading && (
              <div className="space-y-6">
                {drawdown && (
                  <section>
                    <ClassicDraftView loom={loom} drawdown={drawdown} />
                  </section>
                )}

                {draft && (
                  <section>
                    <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                      Draft (AdaCAD)
                    </h3>
                    <dl className="space-y-1 border border-border bg-bg-card p-3 text-xs text-text">
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted">Name</dt>
                        <dd className="text-right font-medium">{getDraftName(draft)}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted">Draft id</dt>
                        <dd className="font-mono text-[11px]">{draft.id}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted">Drawdown</dt>
                        <dd>
                          {warps(draft.drawdown)} warps × {wefts(draft.drawdown)} wefts
                        </dd>
                      </div>
                    </dl>
                  </section>
                )}

                <section>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                    Dressing (library summary)
                  </h3>
                  {dressingRows.length === 0 ? (
                    <p className="text-xs text-muted">No dressing rows returned.</p>
                  ) : (
                    <div className="max-h-[20vh] overflow-y-auto border border-border bg-bg-card">
                      <dl className="space-y-1 p-3 text-xs text-text">
                        {dressingRows.map((row) => (
                          <div
                            key={row.label}
                            className="flex justify-between gap-4 border-b border-border/60 pb-1 last:border-0 last:pb-0"
                          >
                            <dt className="shrink-0 text-muted">{row.label}</dt>
                            <dd className="text-right">{row.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                    Physical size (from EPI / PPI)
                  </h3>
                  <p className="border border-border bg-bg-card p-3 text-xs text-text">
                    {physicalWidth != null && physicalLength != null ? (
                      <>
                        ≈{' '}
                        <strong>{physicalWidth.toFixed(2)}</strong>
                        {' × '}
                        <strong>{physicalLength.toFixed(2)}</strong>
                        {loomSettings.units === 'in' ? ' in' : ' cm'}
                        {' '}
                        (width × length)
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </p>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                    Loom usage
                  </h3>
                  <p className="text-xs text-text">
                    Frames used:{' '}
                    <strong>{framesUsed ?? '—'}</strong>
                    {' · '}
                    Treadles used:{' '}
                    <strong>{treadlesUsed ?? '—'}</strong>
                    {maxShafts ? (
                      <span className="text-muted">
                        {' '}
                        (max shafts / treadles setting: {maxShafts})
                      </span>
                    ) : null}
                  </p>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                    Round-trip check (loom → drawdown)
                  </h3>
                  {roundTripLoading && (
                    <p className="text-xs text-muted">Recomputing drawdown…</p>
                  )}
                  {!roundTripLoading && roundTrip && dims && (
                    <div className="space-y-2 border border-border bg-bg-card p-3 text-xs text-text">
                      <p>
                        Size after <code className="text-[11px]">computeDrawdown</code>
                        :{' '}
                        <strong>{warps(roundTrip)}</strong> ×{' '}
                        <strong>{wefts(roundTrip)}</strong>
                        {' · '}
                        Source preview:{' '}
                        <strong>{dims.warps}</strong> × <strong>{dims.wefts}</strong>
                      </p>
                      {roundTripMismatch === null ? (
                        <p className="text-amber-600/90">
                          Sizes differ — cell-by-cell compare skipped.
                        </p>
                      ) : roundTripMismatch === 0 ? (
                        <p className="text-emerald-600/90">
                          All cells match the source drawdown ({warps(roundTrip)}×
                          {wefts(roundTrip)}).
                        </p>
                      ) : (
                        <p className="text-amber-600/90">
                          {roundTripMismatch} cell(s) differ from the source drawdown.
                        </p>
                      )}
                    </div>
                  )}
                  {!roundTripLoading && !roundTrip && (
                    <p className="text-xs text-muted">Could not compute round-trip.</p>
                  )}
                </section>

                <details className="border border-border bg-bg-card p-3 text-xs">
                  <summary className="cursor-pointer font-medium text-text">
                    Raw threading / tie-up / treadling (copy-friendly)
                  </summary>
                  <div className="mt-3 space-y-3 text-muted">
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
                </details>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
