import type { Piece, SortOption } from '../types';
import { PieceCard } from './PieceCard';

interface GalleryProps {
  pieces: Piece[];
  onPieceClick: (piece: Piece) => void;
  setCardRef: (id: string, el: HTMLElement | null) => void;
  sortBy: SortOption;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function Gallery({ pieces, onPieceClick, setCardRef, sortBy }: GalleryProps) {
  if (pieces.length === 0) {
    return null;
  }

  const isAlphaSort = sortBy === 'title-az' || sortBy === 'title-za';

  if (!isAlphaSort) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {pieces.map((piece) => (
          <PieceCard
            key={piece.id}
            piece={piece}
            onClick={() => onPieceClick(piece)}
            cardRef={(el) => setCardRef(piece.id, el)}
          />
        ))}
      </div>
    );
  }

  const groups = new Map<string, Piece[]>();

  for (const piece of pieces) {
    const firstChar = piece.title.trim().toUpperCase()[0] ?? '';
    const letter = LETTERS.includes(firstChar) ? firstChar : '#';
    const bucket = groups.get(letter) ?? [];
    bucket.push(piece);
    groups.set(letter, bucket);
  }

  const orderedLetters =
    sortBy === 'title-az' ? LETTERS : [...LETTERS].reverse();

  return (
    <div className="space-y-6">
      {orderedLetters.map((letter) => {
        const bucket = groups.get(letter);
        if (!bucket || bucket.length === 0) return null;
        return (
          <section key={letter} aria-label={`Section ${letter}`}>
            <div className="mb-2 text-xs font-normal uppercase tracking-[0.2em] text-muted">
              {letter}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {bucket.map((piece) => (
                <PieceCard
                  key={piece.id}
                  piece={piece}
                  onClick={() => onPieceClick(piece)}
                  cardRef={(el) => setCardRef(piece.id, el)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
