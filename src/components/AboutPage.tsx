interface AboutPageProps {
  onBackToLibrary: () => void;
}

export function AboutPage({ onBackToLibrary }: AboutPageProps) {
  return (
    <main className="mx-auto max-w-prose px-6 py-10 pb-20 font-sans text-text">
      <p className="mb-8 text-sm text-muted">
        <button
          type="button"
          onClick={onBackToLibrary}
          className="text-accent underline decoration-accent/50 underline-offset-2 hover:text-text"
        >
          ← Back to library
        </button>
      </p>

      <h1 className="mb-3 text-2xl font-normal tracking-tight">
        About Syn·cre·tism Library
      </h1>
      <p className="mb-8 text-sm leading-relaxed text-muted">
        An archival interface for mapping computational and textile lineages.
        This site is a{' '}
        <a
          href="https://www.alejandra.design/binary-threads"
          target="_blank"
          rel="noreferrer"
          className="text-accent underline decoration-accent/50 underline-offset-2 hover:text-text"
        >
          research tool for Binary Threads
        </a>
        — a design-research project on textiles, translation, and code.
      </p>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">
          How to use
        </h2>
        <ul className="list-inside list-disc space-y-2 text-sm leading-relaxed text-text">
          <li>
            <strong className="font-medium">Add a piece</strong> with{' '}
            <strong>+ New</strong>. You can build from text (ASCII) or an image
            (bitmap), tune threshold and grid size, and save metadata such as
            title and author.
          </li>
          <li>
            <strong className="font-medium">Browse</strong> the gallery; use{' '}
            <strong>Sort</strong> (A–Z, date, bitmap-only, ASCII-only) and{' '}
            <strong>Search</strong> by title or author. The sidebar letters jump to
            the first piece under each letter.
          </li>
          <li>
            <strong className="font-medium">Open a piece</strong> to see the full
            preview, copy binary or ASCII, export images, and edit or delete the
            entry.
          </li>
          <li>
            <strong className="font-medium">Weave</strong> turns a piece’s binary
            grid into a hand-loom draft (threading, tie-up, treadling, and
            drawdown) using the AdaCAD drafting library. You can adjust warps,
            wefts, shafts, and density notes there.
          </li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">
          Data
        </h2>
        <p className="text-sm leading-relaxed text-text">
          Pieces are stored remotely so the library can persist across devices.
          What you save is available when you return to this site.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">
          Colophon
        </h2>
        <p className="text-sm leading-relaxed text-text">
          Built with React, Vite, Tailwind, Supabase,{' '}
          <code className="text-xs">adacad-drafting-lib</code> (weave drafting),
          and Geist. Weave drafting references the broader lineage from textile
          pattern to programmable logic described in the Binary Threads research.
        </p>
      </section>
    </main>
  );
}
