import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Piece } from '../types';
import { CHAR_SETS, FONT_OPTIONS } from '../types';
import {
  imageToCanvas,
  textToCanvas,
  canvasToAscii,
  canvasToBitmap,
  canvasToBinaryPattern,
  formatTextAsBinaryValues,
  binaryValuesToGrid,
  invertBinaryGrid,
  repeatBinaryGrid,
  getCharSetForPiece,
} from '../conversion';
import type { PreviewResult } from '../preview';
import {
  deleteImageByStorageKey,
  isStorageApiConfigured,
  resolvePieceImageSource,
  uploadImageFile,
} from '../lib/storageApiClient';

export interface CreationFormState {
  title: string;
  description: string;
  author: string;
  inputType: 'image' | 'text';
  inputText: string;
  inputImageDataURL: string;
  type: 'ascii' | 'bitmap' | 'binary';
  gridCols: number;
  invert: boolean;
  threshold: number;
  binaryRepeats: number;
  binaryValues: string;
  charSet: string;
  customChars: string;
  font: string;
  showPreviewGrid: boolean;
  includeGridInSavedImage: boolean;
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
  binaryRepeats: 1,
  binaryValues: '',
  charSet: 'Standard',
  customChars: '',
  font: 'IBM Plex Mono',
  showPreviewGrid: true,
  includeGridInSavedImage: false,
};

interface CreationModalProps {
  open: boolean;
  editPiece: Piece | null;
  onClose: () => void;
  onSave: (piece: Piece) => Promise<void> | void;
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
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [binaryCopied, setBinaryCopied] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const previewDragRef = useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });
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
        inputImageDataURL: resolvePieceImageSource(editPiece) ?? '',
        type: editPiece.type,
        gridCols: editPiece.gridCols,
        invert: editPiece.invert,
        threshold: editPiece.threshold,
        binaryRepeats: editPiece.binaryRepeats ?? 1,
        binaryValues: editPiece.binaryValues ?? '',
        charSet: editPiece.charSet ?? 'Standard',
        customChars: editPiece.customChars ?? '',
        font: editPiece.font ?? 'IBM Plex Mono',
        showPreviewGrid: editPiece.showPreviewGrid ?? true,
        includeGridInSavedImage: editPiece.includeGridInSavedImage ?? false,
      });
    } else {
      setForm(defaultFormState);
    }
    setPreview(null);
    setPreviewError(null);
    setSaveError(null);
    setSelectedImageFile(null);
    setIsSaving(false);
    setPreviewZoom(1);
  }, [open, editPiece]);

  const zoomOutPreview = () =>
    setPreviewZoom((z) => Math.max(0.5, Number((z - 0.1).toFixed(2))));
  const zoomInPreview = () =>
    setPreviewZoom((z) => Math.min(4, Number((z + 0.1).toFixed(2))));
  const resetPreviewView = () => {
    setPreviewZoom(1);
    const el = previewScrollRef.current;
    if (el) {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    }
  };
  const onPreviewPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = previewScrollRef.current;
    if (!el) return;
    previewDragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPreviewPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = previewScrollRef.current;
    const drag = previewDragRef.current;
    if (!el || !drag.dragging) return;
    el.scrollLeft = drag.scrollLeft - (e.clientX - drag.startX);
    el.scrollTop = drag.scrollTop - (e.clientY - drag.startY);
  };
  const onPreviewPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    previewDragRef.current.dragging = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onPreviewWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const step = 0.08;
    if (e.deltaY > 0) {
      setPreviewZoom((z) => Math.max(0.5, Number((z - step).toFixed(2))));
    } else {
      setPreviewZoom((z) => Math.min(4, Number((z + step).toFixed(2))));
    }
  };

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
            } else if (f.type === 'binary') {
              const out = canvasToBinaryPattern(
                canvas,
                ctx,
                f.threshold,
                f.invert
              );
              const repeated = repeatBinaryGrid(out.grid, f.binaryRepeats);
              setPreview({
                type: 'binary',
                grid: repeated,
                cols: repeated[0]?.length ?? 0,
                rows: repeated.length,
              });
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
      if (f.type === 'binary') {
        const rawValues =
          f.binaryValues.trim() || formatTextAsBinaryValues(text);
        const out = binaryValuesToGrid(rawValues);
        const base = f.invert ? invertBinaryGrid(out.grid) : out.grid;
        const repeated = repeatBinaryGrid(base, f.binaryRepeats);
        setPreview({
          type: 'binary',
          grid: repeated,
          cols: repeated[0]?.length ?? 0,
          rows: repeated.length,
        });
        setPreviewError(null);
        return;
      }
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

  const handleSave = async () => {
    if (!form.title.trim() || isSaving) return;

    const piece: Piece = {
      id: editPiece?.id ?? crypto.randomUUID(),
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      author: form.author.trim() || undefined,
      pieceKind: form.type === 'binary' ? 'pattern' : editPiece?.pieceKind,
      dateAdded: editPiece?.dateAdded ?? new Date().toISOString(),
      type: form.type,
      inputType: form.inputType,
      inputText: form.inputType === 'text' ? form.inputText : undefined,
      inputImageDataURL:
        form.inputType === 'image' ? form.inputImageDataURL : undefined,
      gridCols: form.gridCols,
      invert: form.invert,
      threshold: form.threshold,
      binaryRepeats: form.type === 'binary' ? Math.max(1, Math.floor(form.binaryRepeats)) : undefined,
      binaryValues:
        form.type === 'binary'
          ? form.binaryValues.trim() || formatTextAsBinaryValues(form.inputText || ' ')
          : undefined,
      charSet: form.type === 'ascii' ? form.charSet : undefined,
      customChars:
        form.type === 'ascii' && form.charSet === 'Custom'
          ? form.customChars
          : undefined,
      font: form.type === 'ascii' ? form.font : undefined,
      showPreviewGrid: form.showPreviewGrid,
      includeGridInSavedImage: form.includeGridInSavedImage,
    };

    if (form.inputType === 'image' && selectedImageFile) {
      const size = Math.round(selectedImageFile.size / 1024);
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

    setSaveError(null);
    setIsSaving(true);

    try {
      if (piece.inputType === 'image') {
        if (selectedImageFile) {
          if (isStorageApiConfigured()) {
            try {
              const uploaded = await uploadImageFile(selectedImageFile);
              piece.inputImageStorageKey = uploaded.key;
              piece.inputImageURL = uploaded.publicUrl;
              piece.inputImageDataURL = undefined;

              const previousStorageKey = editPiece?.inputImageStorageKey;
              if (previousStorageKey && previousStorageKey !== uploaded.key) {
                try {
                  await deleteImageByStorageKey(previousStorageKey);
                } catch (error) {
                  console.error('Failed to remove replaced S3 image', error);
                }
              }
            } catch (error) {
              console.warn(
                'Storage API upload failed, falling back to embedded image data URL.',
                error
              );
              piece.inputImageStorageKey = undefined;
              piece.inputImageURL = undefined;
              piece.inputImageDataURL = form.inputImageDataURL;
            }
          } else {
            // Fallback for local/dev setups without storage API.
            piece.inputImageStorageKey = undefined;
            piece.inputImageURL = undefined;
            piece.inputImageDataURL = form.inputImageDataURL;
          }
        } else if (!form.inputImageDataURL) {
          if (editPiece?.inputImageStorageKey) {
            try {
              await deleteImageByStorageKey(editPiece.inputImageStorageKey);
            } catch (error) {
              console.error('Failed to remove deleted S3 image', error);
            }
          }
          piece.inputImageDataURL = undefined;
          piece.inputImageStorageKey = undefined;
          piece.inputImageURL = undefined;
        } else {
          piece.inputImageDataURL = editPiece?.inputImageDataURL;
          piece.inputImageStorageKey = editPiece?.inputImageStorageKey;
          piece.inputImageURL = editPiece?.inputImageURL;
        }
      } else {
        if (editPiece?.inputImageStorageKey) {
          try {
            await deleteImageByStorageKey(editPiece.inputImageStorageKey);
          } catch (error) {
            console.error('Failed to remove S3 image after switching input type', error);
          }
        }
        piece.inputImageDataURL = undefined;
        piece.inputImageStorageKey = undefined;
        piece.inputImageURL = undefined;
      }

      await onSave(piece);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaveError(message || 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedImageFile(file);
    setSaveError(null);
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
    setSelectedImageFile(file);
    setSaveError(null);
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
  const binaryValues =
    form.type === 'binary'
      ? form.binaryValues || formatTextAsBinaryValues(form.inputText || ' ')
      : '';
  const handleCopyBinaryValues = async () => {
    if (!binaryValues) return;
    try {
      await navigator.clipboard.writeText(binaryValues);
      setBinaryCopied(true);
      setTimeout(() => setBinaryCopied(false), 1200);
    } catch (error) {
      console.error('Failed to copy binary values', error);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/30 font-sans"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden border border-border bg-bg-card shadow-xl lg:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-b border-border p-5 lg:w-[320px] lg:border-b-0 lg:border-r">
          <h2 className="text-lg font-normal text-text">
            {editPiece ? 'Edit piece' : 'New piece'}
          </h2>
          <div>
            <label className="mb-1 block text-sm text-muted">Input</label>
            <div className="flex gap-2">
              {(['image', 'text'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, inputType: t }))}
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
              className="flex flex-col items-center justify-center border border-dashed border-border bg-bg p-5"
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
                    className="max-h-28 max-w-full object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedImageFile(null);
                      setForm((prev) => ({ ...prev, inputImageDataURL: '' }));
                    }}
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
                setForm((prev) => ({
                  ...prev,
                  inputText: e.target.value,
                  binaryValues:
                    prev.type === 'binary' && !prev.binaryValues.trim()
                      ? formatTextAsBinaryValues(e.target.value)
                      : prev.binaryValues,
                }))
              }
              className="min-h-[120px] w-full border border-border bg-bg-card px-3 py-2 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
              rows={6}
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
            <label className="mb-1 block text-sm text-muted">Description</label>
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, description: e.target.value }))
              }
              className="min-h-[64px] w-full border border-border bg-bg-card px-3 py-2 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
              placeholder="Optional"
              rows={3}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted">Author</label>
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
          {form.type === 'binary' && (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label className="block text-sm text-muted">Binary values</label>
                <button
                  type="button"
                  onClick={handleCopyBinaryValues}
                  className="border border-border px-2 py-1 text-xs text-text hover:bg-border"
                >
                  {binaryCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="max-h-44 overflow-auto border border-border bg-bg px-3 py-2 text-xs font-mono text-text whitespace-pre-wrap break-all">
                {binaryValues || 'Binary output appears here.'}
              </pre>
            </div>
          )}
          <div className="mt-auto flex gap-2 pt-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={!form.title.trim() || isSaving}
              className="border border-accent bg-bg-card px-4 py-2 text-sm font-medium text-accent disabled:opacity-50 hover:bg-border"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="border border-border px-4 py-2 text-sm text-text hover:bg-border"
            >
              Cancel
            </button>
          </div>
          {saveError && <p className="text-sm text-red-400">{saveError}</p>}
        </div>

        <div className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-b border-border p-5 lg:w-[320px] lg:border-b-0 lg:border-r">
          <h3 className="text-sm font-medium text-text">Editing Tools</h3>
          <div>
            <label className="mb-1 block text-sm text-muted">
              Conversion type
            </label>
            <div className="flex gap-2">
              {(['ascii', 'bitmap', 'binary'] as const).map((t) => (
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
                setForm((prev) => ({ ...prev, gridCols: Number(e.target.value) }))
              }
              className="w-full accent-accent"
            />
          </div>
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
                setForm((prev) => ({ ...prev, threshold: Number(e.target.value) }))
              }
              className="w-full accent-accent"
            />
          </div>
          {form.type === 'binary' && (
            <div>
              <label className="mb-1 block text-sm text-muted">
                Vertical repeats
              </label>
              <input
                type="number"
                min={1}
                max={32}
                value={form.binaryRepeats}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    binaryRepeats: Math.max(1, Number(e.target.value) || 1),
                  }))
                }
                className="w-full border border-border bg-bg-card px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={form.invert}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, invert: e.target.checked }))
              }
              className="border-border accent-accent"
            />
            Invert
          </label>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={form.showPreviewGrid}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  showPreviewGrid: e.target.checked,
                }))
              }
              className="border-border accent-accent"
            />
            Show preview grid + axes
          </label>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={form.includeGridInSavedImage}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  includeGridInSavedImage: e.target.checked,
                }))
              }
              className="border-border accent-accent"
            />
            Include grid in saved image export
          </label>
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
                  Text render font
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
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2 text-sm text-muted">
            <span>
              Preview
              {preview && ` — ${preview.cols} cols × ${preview.rows} rows`}
            </span>
            <div className="flex items-center gap-2 text-xs">
              <span>Drag to pan</span>
              <button
                type="button"
                onClick={zoomOutPreview}
                className="border border-border px-2 py-1 text-text hover:bg-border"
              >
                -
              </button>
              <span className="min-w-12 text-center">
                {Math.round(previewZoom * 100)}%
              </span>
              <button
                type="button"
                onClick={zoomInPreview}
                className="border border-border px-2 py-1 text-text hover:bg-border"
              >
                +
              </button>
              <button
                type="button"
                onClick={resetPreviewView}
                className="border border-border px-2 py-1 text-text hover:bg-border"
              >
                Reset
              </button>
            </div>
          </div>
          <div className="flex-1 bg-bg p-4">
            {previewError && <p className="text-sm text-red-400">{previewError}</p>}
            <div
              ref={previewScrollRef}
              onPointerDown={onPreviewPointerDown}
              onPointerMove={onPreviewPointerMove}
              onPointerUp={onPreviewPointerUp}
              onPointerCancel={onPreviewPointerUp}
              onWheel={onPreviewWheel}
              className="h-full overflow-auto border border-border bg-bg-card p-4 cursor-grab active:cursor-grabbing"
              style={{ touchAction: 'none' }}
            >
              {preview && !previewError && (
                <div
                  className="inline-block"
                  style={{ transform: `scale(${previewZoom})`, transformOrigin: 'top left' }}
                >
                  {preview.type === 'ascii' ? (
                    <PreviewWithGrid
                      cols={preview.cols}
                      rows={preview.rows}
                      showGrid={form.showPreviewGrid}
                    >
                      <pre
                        className="whitespace-pre font-mono text-text text-sm leading-tight"
                        style={{ fontFamily: `${form.font}, monospace` }}
                      >
                        {preview.output}
                      </pre>
                    </PreviewWithGrid>
                  ) : preview.type === 'binary' ? (
                    <PreviewWithGrid
                      cols={preview.cols}
                      rows={preview.rows}
                      showGrid={form.showPreviewGrid}
                    >
                      <BinaryPatternPreview grid={preview.grid} />
                    </PreviewWithGrid>
                  ) : (
                    <PreviewWithGrid
                      cols={preview.cols}
                      rows={preview.rows}
                      showGrid={form.showPreviewGrid}
                    >
                      <BitmapPreview grid={preview.grid} />
                    </PreviewWithGrid>
                  )}
                </div>
              )}
            </div>
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

function BinaryPatternPreview({ grid }: { grid: number[][] }) {
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
            fill={v === 0 ? '#1a1a1a' : '#f7f5f0'}
          />
        ))
      )}
    </svg>
  );
}

function PreviewWithGrid({
  cols,
  rows,
  showGrid,
  children,
}: {
  cols: number;
  rows: number;
  showGrid: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative inline-block">
      {children}
      {showGrid && <GridOverlay cols={cols} rows={rows} />}
    </div>
  );
}

function GridOverlay({ cols, rows }: { cols: number; rows: number }) {
  if (!cols || !rows) return null;

  const xMarks = Array.from(
    { length: Math.floor(cols / 10) + 1 },
    (_, i) => i * 10
  );
  const yMarks = Array.from(
    { length: Math.floor(rows / 10) + 1 },
    (_, i) => i * 10
  );

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${cols} ${rows}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {Array.from({ length: cols + 1 }, (_, x) => (
        <line
          key={`vx-${x}`}
          x1={x}
          y1={0}
          x2={x}
          y2={rows}
          stroke={x % 10 === 0 ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.08)'}
          strokeWidth={0.08}
        />
      ))}
      {Array.from({ length: rows + 1 }, (_, y) => (
        <line
          key={`hy-${y}`}
          x1={0}
          y1={y}
          x2={cols}
          y2={y}
          stroke={y % 10 === 0 ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.08)'}
          strokeWidth={0.08}
        />
      ))}

      {xMarks.map((x) => (
        <text
          key={`xt-${x}`}
          x={Math.min(x + 0.4, cols - 1)}
          y={1.4}
          fontSize={1}
          fill="rgba(0,0,0,0.45)"
        >
          {x}
        </text>
      ))}
      {yMarks.map((y) => (
        <text
          key={`yt-${y}`}
          x={0.4}
          y={Math.min(y + 1.2, rows - 0.2)}
          fontSize={1}
          fill="rgba(0,0,0,0.45)"
        >
          {y}
        </text>
      ))}
    </svg>
  );
}
