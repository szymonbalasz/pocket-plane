// Spec §12 "logged": one line per imported source (key, counts per outcome, warnings, ms) and one
// per run of several (books, totals, ms). Measured at the route, around the command, so the time
// includes the folder read and the commit. A run ends when the client says it's the last book, or
// after an idle minute if it never does (the DM reloaded mid-run): that line says "unfinished".
import type { ImportCounts } from "@shared/events/compendium";
import type { Logger } from "../../log";
import { RUN_IDLE_MS } from "./sources/five-etools";

interface Tally {
  run: string;
  books: number;
  failed: number;
  created: number;
  updated: number;
  existing: number;
  warnings: number;
  ms: number;
  timer: Timer;
}

function outcomes(counts: ImportCounts) {
  const t = { created: 0, updated: 0, existing: 0 };
  for (const c of Object.values(counts)) {
    t.created += c.created;
    t.updated += c.updated;
    t.existing += c.existing;
  }
  return t;
}

export class ImportLog {
  private open: Tally | null = null;

  /** `log()`: read per line, so it is always the services' current logger. */
  constructor(private readonly log: () => Logger) {}

  private tally(run: string): Tally {
    if (this.open?.run !== run) {
      this.flush(true);
      this.open = {
        run,
        books: 0,
        failed: 0,
        created: 0,
        updated: 0,
        existing: 0,
        warnings: 0,
        ms: 0,
        timer: this.idleTimer(),
      };
    }
    clearTimeout(this.open.timer);
    this.open.timer = this.idleTimer();
    return this.open;
  }

  private idleTimer(): Timer {
    const timer = setTimeout(() => this.flush(true), RUN_IDLE_MS);
    timer.unref();
    return timer;
  }

  private flush(unfinished: boolean) {
    const t = this.open;
    if (!t) return;
    clearTimeout(t.timer);
    this.open = null;
    this.log().info(
      `compendium import run: ${t.books} ${t.books === 1 ? "book" : "books"}, ${t.failed} failed, ${t.created} created, ${t.updated} updated, ${t.existing} existing, ${t.warnings} warnings, ${Math.round(t.ms)} ms${unfinished ? ", unfinished" : ""}`,
    );
  }

  book(
    r: { source: string; counts: ImportCounts; warnings: readonly unknown[] },
    run: string | undefined,
    ms: number,
  ) {
    const o = outcomes(r.counts);
    // First: an abandoned run's line goes before this book's.
    const t = run === undefined ? null : this.tally(run);
    this.log().info(
      `compendium import ${r.source}: ${o.created} created, ${o.updated} updated, ${o.existing} existing, ${r.warnings.length} warnings, ${Math.round(ms)} ms`,
    );
    if (!t) return;
    t.books++;
    t.created += o.created;
    t.updated += o.updated;
    t.existing += o.existing;
    t.warnings += r.warnings.length;
    t.ms += ms;
  }

  failed(source: string, run: string | undefined, message: string, ms: number) {
    const t = run === undefined ? null : this.tally(run);
    this.log().warn(`compendium import ${source} failed: ${message}, ${Math.round(ms)} ms`);
    if (!t) return;
    t.books++;
    t.failed++;
    t.ms += ms;
  }

  /** The client's last book of `run`. */
  end(run: string) {
    if (this.open?.run === run) this.flush(false);
  }
}
