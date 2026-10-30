// BL-160 inverted text index for a large fixed set of documents (the compendium search index,
// FR-CMP-34): every folded word once, with the documents that contain it. A prefix is a range of
// the sorted words, so a query word costs its postings, not a binary search per document; the
// matches are exactly `searchTier`'s over `textWordsOf` of each text (BL-160 parity test).
import { type CompiledQuery, fold, lowerBound, TEXT_MATCH_MIN } from "./match";

export interface TextIndex {
  /** Every folded word, sorted (code units, as `textWordsOf`). */
  words: readonly string[];
  /** The documents of `words[i]`: `docs[starts[i]]` up to `docs[starts[i + 1]]`. */
  starts: Int32Array;
  docs: Int32Array;
}

/** Index of `texts`; a document is its position. */
export function buildTextIndex(texts: readonly string[]): TextIndex {
  const postings = new Map<string, number[]>();
  for (let doc = 0; doc < texts.length; doc++) {
    const f = fold(texts[doc] as string);
    if (f === "") continue;
    for (const w of f.split(" ")) {
      const p = postings.get(w);
      if (p === undefined) postings.set(w, [doc]);
      else if (p[p.length - 1] !== doc) p.push(doc);
    }
  }
  const words = [...postings.keys()].sort();
  const lists = words.map((w) => postings.get(w) as number[]);
  const starts = new Int32Array(words.length + 1);
  lists.forEach((p, i) => {
    starts[i + 1] = (starts[i] as number) + p.length;
  });
  const docs = new Int32Array(starts[words.length] as number);
  lists.forEach((p, i) => {
    docs.set(p, starts[i] as number);
  });
  return { words, starts, docs };
}

/** Sets `mask[doc] = 1` for every document with a word starting with `prefix`. */
function markPrefix(index: TextIndex, prefix: string, mask: Uint8Array): void {
  const { words, starts, docs } = index;
  const lo = lowerBound(words, prefix);
  // Words starting with `prefix` run from `lo`; find the first that doesn't.
  let hi = words.length;
  for (let l = lo; l < hi; ) {
    const mid = (l + hi) >>> 1;
    if ((words[mid] as string).startsWith(prefix)) l = mid + 1;
    else hi = mid;
  }
  const end = starts[hi] as number;
  for (let i = starts[lo] as number; i < end; i++) mask[docs[i] as number] = 1;
}

/**
 * Per query word, a mask of the `docCount` documents whose text has it (FR-CMP-32 / -33: a word
 * start, either form); null for a word too short to match text.
 */
export function textMasks(
  index: TextIndex,
  q: CompiledQuery,
  docCount: number,
): (Uint8Array | null)[] {
  return q.words.map((w, i) => {
    if (w.length < TEXT_MATCH_MIN) return null;
    const mask = new Uint8Array(docCount);
    for (const f of q.forms[i] as readonly string[]) markPrefix(index, f, mask);
    return mask;
  });
}
