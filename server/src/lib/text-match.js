const LATIN_WORD = /[\p{Script=Latin}\p{N}_'-]/u;

// Han remains substring-searchable; Latin terms retain word boundaries even
// when embedded in Chinese prose. Both inputs use the same Unicode folding.
export function containsText(value, needle) {
  const text = String(value || "").normalize("NFKC").toLowerCase();
  const term = String(needle || "").normalize("NFKC").toLowerCase();
  if (!term) return false;
  let start = text.indexOf(term);
  while (start !== -1) {
    const end = start + term.length;
    const left = LATIN_WORD.test(term[0]) && LATIN_WORD.test(text[start - 1] || "");
    const right = LATIN_WORD.test(term.at(-1)) && LATIN_WORD.test(text[end] || "");
    if (!left && !right) return true;
    start = text.indexOf(term, start + 1);
  }
  return false;
}
