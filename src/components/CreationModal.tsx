import { useState, useEffect, useCallback, useRef } from 'react';
import type { Piece } from '../types';
import { CHAR_SETS, FONT_OPTIONS } from '../types';
import {
  imageToCanvas,
  textToCanvas,
  canvasToAscii,
  canvasToBitmap,
  getCharSetForPiece,
} from '../conversion';
import type { PreviewResult } from '../preview';

export interface CreationFormState {
  title: string;
  description: string;
  author: string;
  inputType: 'image' | 'text';
  inputText: string;
  inputImageDataURL: string;
  type: 'ascii' | 'bitmap';
  gridCols: number;
  invert: boolean;
  threshold: number;
  charSet: string;
  customChars: string;
  font: string;
}

const defaultFormState: CreationFormState = {
  title: '',
  description: '',
  author: '',
  inputType: 'text',
  inputText: '',
  inputImageDataURL: '',
  type: 'ascii',
  gridCols: 80,
  invert: false,
  threshold: 128,
  charSet: 'Standard',
  customChars: '',
  font: 'IBM Plex Mono',
};

interface CreationModalProps {
  open: boolean;
  editPiece: Piece | null;
  onClose: () => void;
  onSave: (piece: Piece) => void;
}

export function CreationModal({
  open,
  editPiece,
  onClose,
  onSave,
}: CreationModalProps) {
  const [form, setForm] = useState<CreationFormState>(defaultFormState);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (!open) return;
    if (editPiece) {
      setForm({
        title: editPiece.title,
        description: editPiece.description ?? '',
        author: editPiece.author ?? '',
        inputType: editPiece.inputType,
        inputText: editPiece.inputText ?? '',
        inputImageDataURL: editPiece.inputImageDataURL ?? '',
        type: editPiece.type,
        gridCols: editPiece.gridCols,
        invert: editPiece.invert,
        threshold: editPiece.threshold,
        charSet: editPiece.charSet ?? 'Standard',
        customChars: editPiece.customChars ?? '',
        font: editPiece.font ?? 'IBM Plex Mono',
      });
    } else {
      setForm(defaultFormState);
    }
    setPreview(null);
    setPreviewError(null);
  }, [open, editPiece]);

  const runPreview = useCallback(
    (f: CreationFormState) => {
      const cols = Math.max(20, Math.min(200, f.gridCols));
      const chars =
        f.charSet === 'Custom'
          ? f.customChars || '@'
          : getCharSetForPiece(f.charSet, f.customChars);

      if (f.inputType === 'image' && f.inputImageDataURL) {
        imageToCanvas(f.inputImageDataURL, cols)
          .then(({ canvas, ctx }) => {
            if (f.type === 'ascii') {
              const out = canvasToAscii(
                canvas,
                ctx,
                chars,
                f.invert,
                f.threshold
              );
              setPreview({ type: 'ascii', ...out });
            } else {
              const out = canvasToBitmap(
                canvas,
                ctx,
                f.threshold,
                f.invert
              );
              setPreview({ type: 'bitmap', ...out });
            }
            setPreviewError(null);
          })
          .catch((err) => {
            setPreviewError(String(err));
            setPreview(null);
          });
        return;
      }
      const text = f.inputText || ' ';
      const { canvas, ctx } = textToCanvas(text, cols, f.font);
      if (f.type === 'ascii') {
        const out = canvasToAscii(canvas, ctx, chars, f.invert, f.threshold);
        setPreview({ type: 'ascii', ...out });
      } else {
        const out = canvasToBitmap(canvas, ctx, f.threshold, f.invert);
        setPreview({ type: 'bitmap', ...out });
      }
      setPreviewError(null);
    },
    []
  );

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      runPreview(form);
    }, 100);
    debounceRef.current = id;
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, form, runPreview]);

  const handleSave = () => {
    if (!form.title.trim()) return;
    const piece: Piece = {
      id: editPiece?.id ?? crypto.randomUUID(),
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      author: form.author.trim() || undefined,
      dateAdded: editPiece?.dateAdded ?? new Date().toISOString(),
      type: form.type,
      inputType: form.inputType,
      inputText: form.inputType === 'text' ? form.inputText : undefined,
      inputImageDataURL:
        form.inputType === 'image' ? form.inputImageDataURL : undefined,
      gridCols: form.gridCols,
      invert: form.invert,
      threshold: form.threshold,
      charSet: form.type === 'ascii' ? form.charSet : undefined,
      customChars:
        form.type === 'ascii' && form.charSet === 'Custom'
          ? form.customChars
          : undefined,
      font: form.type === 'ascii' ? form.font : undefined,
    };
    if (form.inputType === 'image' && form.inputImageDataURL) {
      const size = Math.round((form.inputImageDataURL.length * 3) / 4 / 1024);
      if (size > 500) {
        if (
          !window.confirm(
            `This image is ~${size} KB in storage. Save anyway?`
          )
        ) {
          return;
        }
      }
    }
    onSave(piece);
    onClose();
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setForm((prev) => ({
        ...prev,
        inputImageDataURL: String(reader.result),
        inputText: '',
      }));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !/^image\/(png|jpeg|jpg|gif)$/i.test(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => {
      setForm((prev) => ({
        ...prev,
        inputType: 'image',
        inputImageDataURL: String(reader.result),
        inputText: '',
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 font-sans"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden border border-border bg-bg-card shadow-xl lg:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: controls */}
        <div className="flex w-full flex-col gap-4 overflow-y-auto border-b border-border p-6 lg:w-[380px] lg:border-b-0 lg:border-r">
          <h2 className="text-lg font-normal text-text">
            {editPiece ? 'Edit piece' : 'New piece'}
          </h2>

          {/* Input type */}
          <div>
            <label className="mb-1 block text-sm text-muted">
              Input
            </label>
            <div className="flex gap-2">
              {(['image', 'text'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({ ...prev, inputType: t }))
                  }
                    className={`border px-3 py-1.5 text-sm capitalize ${
                    form.inputType === t
                      ? 'border-accent bg-border text-text'
                      : 'border-border text-muted'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {form.inputType === 'image' ? (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className="flex flex-col items-center justify-center border border-dashed border-border bg-bg p-6"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/gif"
                onChange={handleFile}
                className="hidden"
              />
              {form.inputImageDataURL ? (
                <div className="flex flex-col items-center gap-2">
                  <img
                    src={form.inputImageDataURL}
                    alt="Upload"
                    className="max-h-32 max-w-full object-contain"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        inputImageDataURL: '',
                      }))
                    }
                    className="text-sm text-accent hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-sm text-accent hover:underline"
                >
                  Drop image or click to pick
                </button>
              )}
            </div>
          ) : (
            <textarea
              placeholder="Type your text…"
              value={form.inputText}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, inputText: e.target.value }))
              }
              className="min-h-[100px] w-full border border-border bg-bg-card px-3 py-2 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
              rows={4}
            />
          )}

          <div>
            <label className="mb-1 block text-sm text-muted">
              Title <span className="text-muted">*</span>
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, title: e.target.value }))
              }
              className="w-full border border-border bg-bg-card px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              placeholder="Piece title"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted">
              Description
            </label>
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, description: e.target.value }))
              }
              className="min-h-[60px] w-full border border-border bg-bg-card px-3 py-2 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
              placeholder="Optional"
              rows={2}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted">
              Author
            </label>
            <input
              type="text"
              value={form.author}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, author: e.target.value }))
              }
              className="w-full border border-border bg-bg-card px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              placeholder="Optional"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-muted">
              Conversion type
            </label>
            <div className="flex gap-2">
              {(['ascii', 'bitmap'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, type: t }))}
                    className={`border px-3 py-1.5 text-sm uppercase ${
                    form.type === t
                      ? 'border-accent bg-border text-text'
                      : 'border-border text-muted'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-muted">
              Grid size (columns): {form.gridCols}
            </label>
            <input
              type="range"
              min={20}
              max={200}
              value={form.gridCols}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  gridCols: Number(e.target.value),
                }))
              }
              className="w-full accent-accent"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={form.invert}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, invert: e.target.checked }))
              }
              className=" border-border accent-accent"
            />
            Invert
          </label>

          <div>
            <label className="mb-1 block text-sm text-muted">
              Threshold: {form.threshold}
            </label>
            <input
              type="range"
              min={0}
              max={255}
              value={form.threshold}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  threshold: Number(e.target.value),
                }))
              }
              className="w-full accent-accent"
            />
          </div>

          {form.type === 'ascii' && (
            <>
              <div>
                <label className="mb-1 block text-sm text-muted">
                  Character set
                </label>
                <select
                  value={form.charSet}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, charSet: e.target.value }))
                  }
                  className="w-full border border-border bg-bg-card px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
                >
                  {Object.keys(CHAR_SETS).map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              {form.charSet === 'Custom' && (
                <div>
                  <label className="mb-1 block text-sm text-muted">
                    Custom characters (dark → light)
                  </label>
                  <input
                    type="text"
                    value={form.customChars}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        customChars: e.target.value,
                      }))
                    }
                    className="w-full border border-border bg-bg-card px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
                    placeholder="e.g. .:-=+*#%@"
                  />
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm text-muted">
                  Text render font (for conversion)
                </label>
                <select
                  value={form.font}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, font: e.target.value }))
                  }
                  className="w-full border border-border bg-bg-card px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
                >
                  {FONT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={!form.title.trim()}
              className="border border-accent bg-bg-card px-4 py-2 text-sm font-medium text-accent disabled:opacity-50 hover:bg-border"
            >
              Save
            </button>
            <button
              type="button"
              onClick={onClose}
              className="border border-border px-4 py-2 text-sm text-text hover:bg-border"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Right: preview */}
        <div className="flex flex-1 flex-col overflow-hidden border-t border-border lg:border-t-0 lg:border-l-0">
          <div className="border-b border-border px-4 py-2 text-sm text-muted">
            Preview
            {preview &&
              ` — ${preview.cols} cols × ${preview.rows} rows`}
          </div>
          <div className="flex-1 overflow-auto bg-bg p-4">
            {previewError && (
              <p className="text-sm text-red-400">{previewError}</p>
            )}
            {preview && !previewError && (
              <>
                {preview.type === 'ascii' ? (
                  <pre
                    className="whitespace-pre font-mono text-text text-sm leading-tight"
                    style={{ fontFamily: `${form.font}, monospace` }}
                  >
                    {preview.output}
                  </pre>
                ) : (
                  <BitmapPreview grid={preview.grid} />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BitmapPreview({ grid }: { grid: number[][] }) {
  if (!grid.length) return null;
  const cell = 4;
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
