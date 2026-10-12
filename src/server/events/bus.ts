// In-process domain event bus (ADR-0016). Listeners run synchronously, after commit,
// in subscription order (ADR-0021 F). A failing listener is logged, never rolls back.
import type { Logger } from "../log";
import type { DispatchedEvent } from "./types";

export type Listener = (e: DispatchedEvent) => void;

export class EventBus {
  private listeners: { name: string; fn: Listener }[] = [];

  constructor(private readonly log: Logger) {}

  subscribe(name: string, fn: Listener): () => void {
    const entry = { name, fn };
    this.listeners.push(entry);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== entry);
    };
  }

  dispatch(e: DispatchedEvent): void {
    for (const l of this.listeners) {
      try {
        l.fn(e);
      } catch (err) {
        this.log.error(`listener "${l.name}" failed on ${e.event.type}`, err);
      }
    }
  }
}
