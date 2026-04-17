import { useState } from 'react';
import type { SortMode } from '../types';

interface TopBarProps {
  appView: 'library' | 'about';
  onGoLibrary: () => void;
  onGoAbout: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchSuggestions: { title: string; author?: string; match: 'title' | 'author' }[];
  onSearchSelect: (title: string) => void;
  mode: SortMode;
  onModeChange: (m: SortMode) => void;
  onNewClick: () => void;
  onWeaveClick: () => void;
  searchFocused: boolean;
  onSearchFocus: (f: boolean) => void;
}

export function TopBar({
  appView,
  onGoLibrary,
  onGoAbout,
  searchQuery,
  onSearchChange,
  searchSuggestions,
  onSearchSelect,
  mode,
  onModeChange,
  onNewClick,
  onWeaveClick,
  searchFocused,
  onSearchFocus,
}: TopBarProps) {
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border bg-bg px-4 py-3 font-sans">
      {/* Mobile / tablet overlay for search + sort */}
      {appView === 'library' && mobilePanelOpen && (
        <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/40 px-4 pt-16 lg:hidden">
          <div className="w-full max-w-md border border-border bg-bg-card p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-sm text-muted">Search &amp; sort</span>
              <button
                type="button"
                className="px-2 text-sm text-accent hover:text-text"
                onClick={() => setMobilePanelOpen(false)}
                aria-label="Close search and sort panel"
              >
                ×
              </button>
            </div>

            <div className="relative mb-4">
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
                className="w-full border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
                aria-label="Search pieces"
                aria-autocomplete="list"
                aria-controls="search-suggestions-mobile"
              />
              {searchFocused &&
                (searchQuery.trim() || searchSuggestions.length > 0) && (
                  <ul
                    id="search-suggestions-mobile"
                    className="absolute left-0 right-0 top-full z-40 mt-1 max-h-60 overflow-auto border border-border bg-bg-card py-1 shadow-lg"
                    role="listbox"
                  >
                    {searchSuggestions.length === 0 && searchQuery.trim() ? (
                      <li className="px-3 py-2 text-sm text-muted">
                        No results
                      </li>
                    ) : (
                      searchSuggestions.slice(0, 8).map((s) => (
                        <li
                          key={`${s.title}-${s.author ?? ''}`}
                          role="option"
                        >
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-border/50"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              onSearchSelect(s.title);
                              setMobilePanelOpen(false);
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

            <div className="border-t border-border pt-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-muted">
                Sort
              </p>
              <div className="flex flex-wrap gap-2">
                {(['alphabetical', 'date', 'bitmap', 'ascii'] as SortMode[]).map(
                  (m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => onModeChange(m)}
                      className={[
                        'px-2 py-1 border text-xs',
                        m === mode
                          ? 'border-accent text-accent bg-bg'
                          : 'border-border text-muted bg-bg hover:border-accent',
                      ].join(' ')}
                    >
                      {m === 'alphabetical' && 'A–Z'}
                      {m === 'date' && 'Newest'}
                      {m === 'bitmap' && 'Bitmap'}
                      {m === 'ascii' && 'ASCII'}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Left: brand + primary actions (vertically centered together) */}
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          {appView === 'library' ? (
            <h1 className="text-lg font-normal tracking-tight text-text">
              Syn·cre·tism Library
            </h1>
          ) : (
            <button
              type="button"
              onClick={onGoLibrary}
              className="text-left text-lg font-normal tracking-tight text-text hover:text-muted"
            >
              Syn·cre·tism Library
            </button>
          )}
          <p className="max-w-md text-xs leading-snug text-muted">
            An archival interface for mapping computational and textile lineages.
          </p>
          <p className="max-w-md text-xs leading-snug">
            <a
              href="https://www.alejandra.design/binary-threads"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline decoration-accent/50 underline-offset-2 hover:text-text"
            >
              Research tool for Spinning the Digital Thread design research.
            </a>
          </p>
        </div>

        <nav
          className="flex shrink-0 flex-wrap items-center gap-2"
          aria-label="Primary"
        >
          {appView === 'library' && (
            <>
              <button
                type="button"
                onClick={onNewClick}
                className="border border-accent bg-bg-card px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-border"
              >
                + New
              </button>
              <button
                type="button"
                onClick={onWeaveClick}
                className="border border-border bg-bg-card px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-border"
              >
                Weave
              </button>
              <button
                type="button"
                onClick={onGoAbout}
                className="border border-border bg-bg-card px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-accent hover:text-text"
              >
                About
              </button>
              <button
                type="button"
                className="flex items-center justify-center border border-border bg-bg-card px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-border lg:hidden"
                onClick={() => setMobilePanelOpen(true)}
              >
                Sort
              </button>
            </>
          )}
          {appView === 'about' && (
            <button
              type="button"
              onClick={onGoLibrary}
              className="border border-border bg-bg-card px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-border lg:hidden"
            >
              Library
            </button>
          )}
        </nav>
      </div>

      {/* Right: sort + search (desktop) / Library (about) */}
      <div className="hidden shrink-0 items-center justify-end gap-4 text-sm lg:flex">
        {appView === 'about' && (
          <button
            type="button"
            onClick={onGoLibrary}
            className="border border-accent bg-bg-card px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-border"
          >
            Library
          </button>
        )}
        {appView === 'library' && (
          <>
            <div className="flex items-center gap-2">
              <span className="hidden text-xs uppercase tracking-wide text-muted sm:inline">
                Sort
              </span>
              <div className="flex gap-1">
                {(['alphabetical', 'date', 'bitmap', 'ascii'] as SortMode[]).map(
                  (m) => (
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
                      {m === 'alphabetical' && 'A–Z'}
                      {m === 'date' && 'Newest'}
                      {m === 'bitmap' && 'Bitmap'}
                      {m === 'ascii' && 'ASCII'}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="relative min-w-[180px] max-w-xs">
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
          {searchFocused &&
            (searchQuery.trim() || searchSuggestions.length > 0) && (
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
          </>
        )}
      </div>
    </header>
  );
}
