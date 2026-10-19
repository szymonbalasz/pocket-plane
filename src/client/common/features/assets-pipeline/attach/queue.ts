// Upload queue of the image attach control (FR-ASSET-21): files from a pick, a drop or a paste go
// through one queue, one upload at a time, each as an attachment (`listed=false`). Slots are
// counted when files are accepted: free = max − count − queued − in flight (review #17). DOM-free.
import { MAX_UPLOAD_BYTES } from "@shared/assets-pipeline/schemas";
import type { UploadHandlers, UploadOptions, UploadOutcome } from "../upload";

/** FR-ASSET-21 client pre-check (by MIME); the server stays authoritative (sniffed format). */
export const ATTACH_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
];

export const UNSUPPORTED = "Unsupported file type";
export const TOO_LARGE = "File over 25 MB";

export function precheck(file: { type: string; size: number }): string | null {
  if (!ATTACH_TYPES.includes(file.type)) return UNSUPPORTED;
  if (file.size > MAX_UPLOAD_BYTES) return TOO_LARGE;
  return null;
}

export const noMoreImages = (max: number) => `No more images (${max})`;
export const onlyMore = (n: number) => `Only ${n} more image${n === 1 ? "" : "s"}`;

/** One file to send; `name` overrides the file name (pastes, FR-ASSET-22). */
export interface AttachItem {
  file: File;
  name?: string;
}

export interface AttachStatus {
  phase: "idle" | "sending" | "processing";
  /** 1-based position of the file being sent in this run, and the run's length. */
  index: number;
  total: number;
  pct: number;
  /** One line per failed / refused file since the last add. */
  errors: readonly string[];
}

export const IDLE_STATUS: AttachStatus = { phase: "idle", index: 0, total: 0, pct: 0, errors: [] };

/** "Uploading 2 of 3 · 45 %", then "Processing…"; null while idle. */
export function progressText(s: AttachStatus): string | null {
  if (s.phase === "sending") return `Uploading ${s.index} of ${s.total} · ${s.pct} %`;
  if (s.phase === "processing") return "Processing…";
  return null;
}

export interface QueueDeps {
  upload(file: File, opts: UploadOptions, h: UploadHandlers): Promise<UploadOutcome>;
  /** Once per finished image, in queue order, straight from the response (FR-ASSET-21). */
  onAdd(assetId: string): void;
  onChange(status: AttachStatus): void;
}

export class AttachQueue {
  private items: AttachItem[] = [];
  private running = false;
  private done = 0;
  private status: AttachStatus = IDLE_STATUS;

  constructor(private readonly deps: QueueDeps) {}

  /** Files accepted and not finished (queued + in flight). */
  get pending(): number {
    return this.items.length + (this.running ? 1 : 0);
  }

  /**
   * Accept files with `free` = max − count (the caller's slots); the queue subtracts its own
   * pending files. Pre-check failures are refused per file; files beyond the slots are not sent
   * (the first n are). Clears the previous add's errors.
   */
  add(items: readonly AttachItem[], free: number, max: number): void {
    const errors: string[] = [];
    const ok: AttachItem[] = [];
    for (const it of items) {
      const why = precheck(it.file);
      if (why) errors.push(`${labelOf(it)}: ${why}`);
      else ok.push(it);
    }
    const room = Math.max(0, free - this.pending);
    if (ok.length > room) errors.push(room === 0 ? noMoreImages(max) : onlyMore(room));
    const take = ok.slice(0, room);
    this.items.push(...take);
    this.set({
      errors,
      total: this.running ? this.status.total + take.length : take.length,
    });
    void this.pump();
  }

  /** A refusal with no file sent (paste with no slot left / while disabled). */
  refuse(message: string): void {
    this.set({ errors: [message] });
  }

  private set(patch: Partial<AttachStatus>) {
    this.status = { ...this.status, ...patch };
    this.deps.onChange(this.status);
  }

  private async pump() {
    if (this.running || this.items.length === 0) return;
    this.running = true;
    this.done = 0;
    for (let it = this.items.shift(); it; it = this.items.shift()) {
      this.set({ phase: "sending", index: this.done + 1, pct: 0 });
      const r = await this.deps.upload(
        it.file,
        { listed: false, ...(it.name !== undefined ? { name: it.name } : {}) },
        {
          onProgress: (pct) => this.set({ phase: "sending", pct }),
          onProcessing: () => this.set({ phase: "processing" }),
        },
      );
      this.done++;
      if (r.kind === "ok") this.deps.onAdd(r.asset.id);
      else if (r.kind === "error")
        this.set({ errors: [...this.status.errors, `${labelOf(it)}: ${r.message}`] });
      // 401: the uploader reset the secret (back to login); nothing else is sent.
      else this.items = [];
    }
    this.running = false;
    this.set({ phase: "idle", index: 0, total: 0, pct: 0 });
  }
}

const labelOf = (it: AttachItem) => it.name ?? it.file.name;
