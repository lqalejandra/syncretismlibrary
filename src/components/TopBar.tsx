import type { SortMode } from '../types';

interface TopBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchSuggestions: { title: string; author?: string; match: 'title' | 'author' }[];
  onSearchSelect: (title: string) => void;
  mode: SortMode;
  onModeChange: (m: SortMode) => void;
  onNewClick: () => void;
  searchFocused: boolean;
  onSearchFocus: (f: boolean) => void;
}

export function TopBar({
  searchQuery,
  onSearchChange,
  searchSuggestions,
  onSearchSelect,
  mode,
  onModeChange,
  onNewClick,
  searchFocused,
  onSearchFocus,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-border bg-bg px-4 py-3 font-sans">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-normal tracking-tight text-text">Syn·cre·tism Library</h1>
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <input
            type="search"
            placeholder="Search title or author…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => onSearchFocus(true)}
            onBlur={() => setTimeout(() => onSearchFocus(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchSuggestions.length > 0) {
                const first = searchSuggestions[0];
                onSearchSelect(first.title);
              }
            }}
            className="w-full border border-border bg-bg-card px-3 py-2 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
            aria-label="Search pieces"
            aria-autocomplete="list"
            aria-controls="search-suggestions"
          />
          {searchFocused && (searchQuery.trim() || searchSuggestions.length > 0) && (
            <ul
              id="search-suggestions"
              className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-auto border border-border bg-bg-card py-1 shadow-lg"
              role="listbox"
            >
              {searchSuggestions.length === 0 && searchQuery.trim() ? (
                <li className="px-3 py-2 text-sm text-muted">No results</li>
              ) : (
                searchSuggestions.slice(0, 8).map((s) => (
                  <li key={`${s.title}-${s.author ?? ''}`} role="option">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-border/50"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onSearchSelect(s.title);
                      }}
                    >
                      <span>
                        {s.match === 'title' ? `"${s.title}"` : s.title}
                        {s.author && ` — ${s.author}`}
                      </span>
                      {s.match === 'author' && (
                        <span className="shrink-0 bg-border px-1.5 py-0.5 text-xs text-muted">
                          author
                        </span>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <div className="flex gap-1">
          {(['alphabetical', 'date', 'bitmap', 'ascii'] as SortMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              className={[
                'px-2 py-1 border text-xs',
                m === mode
                  ? 'border-accent text-accent bg-bg-card'
                  : 'border-border text-muted bg-bg-card hover:border-accent',
              ].join(' ')}
            >
              {m === 'alphabetical' && 'alphabetical'}
              {m === 'date' && 'date'}
              {m === 'bitmap' && 'bitmap'}
              {m === 'ascii' && 'ascii'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onNewClick}
          className="border border-accent bg-bg-card px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-border"
        >
          + New
        </button>
      </div>
    </header>
  );
}
