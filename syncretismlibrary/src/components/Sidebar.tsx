import { useCallback } from 'react';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

interface SidebarProps {
  pieces: { title: string }[];
  onLetterClick: (letter: string) => void;
}

export function Sidebar({ pieces, onLetterClick }: SidebarProps) {
  const firstLetterByTitle = useCallback((title: string) => {
    const c = title.trim().toUpperCase()[0];
    return c >= 'A' && c <= 'Z' ? c : null;
  }, []);

  const hasLetter = useCallback(
    (letter: string) => pieces.some((p) => firstLetterByTitle(p.title) === letter),
    [pieces, firstLetterByTitle]
  );

  return (
    <aside
      className="fixed left-0 top-0 z-10 flex flex-col items-center gap-0.5 py-24 pl-2 pr-1 text-sm font-sans text-text"
      aria-label="Alphabet index"
    >
      {LETTERS.map((letter) => {
        const active = hasLetter(letter);
        return (
          <button
            key={letter}
            type="button"
            onClick={() => active && onLetterClick(letter)}
            disabled={!active}
            className={`min-w-[1.5rem] py-0.5 text-center transition-opacity ${
              active
                ? 'text-accent hover:opacity-100 opacity-80'
                : 'text-muted/50 cursor-default'
            }`}
            aria-label={`Jump to ${letter}`}
          >
            {letter}
          </button>
        );
      })}
    </aside>
  );
}
