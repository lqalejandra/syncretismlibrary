import { useState, useCallback, useRef, useEffect } from 'react';
import type { Piece, SortOption, SortMode } from './types';
import { loadPieces, addPiece, updatePiece, deletePiece } from './storage';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Gallery } from './components/Gallery';
import { CreationModal } from './components/CreationModal';
import { DetailModal } from './components/DetailModal';

function sortPieces(pieces: Piece[], sortBy: SortOption): Piece[] {
  const arr = [...pieces];
  switch (sortBy) {
    case 'date-desc':
      return arr.sort(
        (a, b) =>
          new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime()
      );
    case 'date-asc':
      return arr.sort(
        (a, b) =>
          new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime()
      );
    case 'title-az':
      return arr.sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
      );
    case 'title-za':
      return arr.sort((a, b) =>
        b.title.localeCompare(a.title, undefined, { sensitivity: 'base' })
      );
    default:
      return arr;
  }
}

function searchPieces(
  pieces: Piece[],
  query: string
): Piece[] {
  const q = query.trim().toLowerCase();
  if (!q) return pieces;
  return pieces.filter(
    (p) =>
      p.title.toLowerCase().includes(q) ||
      (p.author?.toLowerCase().includes(q) ?? false)
  );
}

function getSearchSuggestions(
  pieces: Piece[],
  query: string
): { title: string; author?: string; match: 'title' | 'author' }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: { title: string; author?: string; match: 'title' | 'author' }[] = [];
  const seen = new Set<string>();
  for (const p of pieces) {
    const titleMatch = p.title.toLowerCase().includes(q);
    const authorMatch = p.author?.toLowerCase().includes(q);
    if (titleMatch && !seen.has(`t:${p.title}`)) {
      seen.add(`t:${p.title}`);
      out.push({ title: p.title, author: p.author, match: 'title' });
    }
    if (authorMatch && p.author && !seen.has(`a:${p.title}`)) {
      seen.add(`a:${p.title}`);
      out.push({ title: p.title, author: p.author, match: 'author' });
    }
  }
  return out;
}

export default function App() {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [mode, setMode] = useState<SortMode>('date');
  const [creationOpen, setCreationOpen] = useState(false);
  const [detailPiece, setDetailPiece] = useState<Piece | null>(null);
  const [editPiece, setEditPiece] = useState<Piece | null>(null);
  const cardRefsMap = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    let cancelled = false;

    const fetchPieces = async () => {
      const initial = await loadPieces();
      if (!cancelled) {
        setPieces(initial);
        setLoading(false);
      }
    };

    fetchPieces();

    return () => {
      cancelled = true;
    };
  }, []);

  const sortBy: SortOption = mode === 'date' ? 'date-desc' : 'title-az';

  const filteredByMode = pieces.filter((p) => {
    if (mode === 'bitmap') return p.type === 'bitmap';
    if (mode === 'ascii') return p.type === 'ascii';
    return true;
  });

  const allSorted = sortPieces(filteredByMode, sortBy);
  const filtered = searchPieces(allSorted, searchQuery);
  const suggestions = getSearchSuggestions(pieces, searchQuery);

  const setCardRef = useCallback((id: string, el: HTMLElement | null) => {
    cardRefsMap.current[id] = el;
  }, []);

  const scrollToLetter = useCallback(
    (letter: string) => {
      const first = filtered.find(
        (p) => (p.title.trim().toUpperCase()[0] ?? '') === letter
      );
      if (first) {
        const el = cardRefsMap.current[first.id];
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [filtered]
  );

  const handleSearchSelect = useCallback(
    (title: string) => {
      const piece = filtered.find((p) => p.title === title);
      if (piece) {
        const el = cardRefsMap.current[piece.id];
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setDetailPiece(piece);
        setSearchQuery('');
        setSearchFocused(false);
      }
    },
    [filtered]
  );

  const handleSavePiece = useCallback(
    async (piece: Piece) => {
      if (editPiece) {
        const next = await updatePiece(piece.id, piece);
        setPieces(next);
      } else {
        const next = await addPiece(piece);
        setPieces(next);
      }
      setEditPiece(null);
      setCreationOpen(false);
    },
    [editPiece]
  );

  const handleDeletePiece = useCallback(async (id: string) => {
    const next = await deletePiece(id);
    setPieces(next);
    setDetailPiece(null);
  }, []);

  const handleEditFromDetail = useCallback((piece: Piece) => {
    setDetailPiece(null);
    setEditPiece(piece);
    setCreationOpen(true);
  }, []);

  return (
    <div className="min-h-screen bg-bg font-sans text-text">
      <Sidebar
        pieces={pieces}
        onLetterClick={scrollToLetter}
      />
      <div className="pl-10">
        <TopBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchSuggestions={suggestions}
          onSearchSelect={handleSearchSelect}
          mode={mode}
          onModeChange={setMode}
          onNewClick={() => {
            setEditPiece(null);
            setCreationOpen(true);
          }}
          searchFocused={searchFocused}
          onSearchFocus={setSearchFocused}
        />

        <main className="p-6">
          {loading ? (
            <LoadingState />
          ) : pieces.length === 0 ? (
            <EmptyState onCreate={() => setCreationOpen(true)} />
          ) : filtered.length === 0 ? (
            <NoResultsState query={searchQuery} />
          ) : (
            <Gallery
              pieces={filtered}
              onPieceClick={setDetailPiece}
              setCardRef={setCardRef}
              sortBy={sortBy}
            />
          )}
        </main>
      </div>

      <CreationModal
        open={creationOpen}
        editPiece={editPiece}
        onClose={() => {
          setCreationOpen(false);
          setEditPiece(null);
        }}
        onSave={handleSavePiece}
      />

      <DetailModal
        piece={detailPiece}
        open={detailPiece !== null}
        onClose={() => setDetailPiece(null)}
        onEdit={handleEditFromDetail}
        onDelete={handleDeletePiece}
      />
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <pre className="mb-6 font-mono text-xs text-muted whitespace-pre">
        {`
 library
`}
      </pre>
      <p className="mb-6 text-muted">No pieces yet.</p>
      <button
        type="button"
        onClick={onCreate}
        className="border border-accent bg-bg-card px-8 py-4 text-lg font-medium text-accent transition-colors hover:bg-border"
      >
        + Create your first piece
      </button>
    </div>
  );
}

function NoResultsState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-muted">
        No results for &quot;{query}&quot;
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-muted">Loading your library…</p>
    </div>
  );
}
