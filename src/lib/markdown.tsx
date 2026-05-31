/**
 * Tiny zero-dependency Markdown renderer.
 *
 * The synthesizer emits clean Markdown (headings, bold, bullet/numbered
 * lists, inline + fenced code, links) plus inline `[N]` citation markers.
 * Rendering it as a raw string in a <p> wasted that structure — bullet
 * lists showed as "- foo" plaintext, commands had no monospace, key terms
 * weren't bold. This renderer turns it into real elements.
 *
 * Why not react-markdown? It pulls remark + a parser tree + plugins —
 * ~40 KB for a feature set we don't need. This handles exactly what the
 * synthesizer produces in ~160 LOC with no deps, and it is streaming-safe:
 * a half-arrived fenced block or unterminated bold renders gracefully
 * instead of throwing.
 *
 * Supported: # headings, **bold**, *italic* / _italic_, `inline code`,
 * ```fenced code```, - / * bullet lists, 1. numbered lists, [text](url)
 * links, and [N] citation chips.
 */

import type { ReactNode } from "react";

const CITATION = /^\[(\d+)\]$/;

/**
 * Allowlist URL schemes for rendered links. The link text + URL come from the
 * LLM, which can be prompt-injected. React blocks `javascript:` but NOT
 * `data:text/html` or `vbscript:` — both are working XSS vectors in `href`.
 * Only http(s), mailto, and site-relative paths render as links; anything else
 * falls back to plain text.
 */
function isSafeUrl(url: string): boolean {
  const u = url.trim();
  if (/^(https?:|mailto:)/i.test(u)) return true;
  if (/^\/[^/]/.test(u)) return true; // site-relative "/path" (not "//host")
  return false;
}

/** Inline scanner: bold, italic, code, links, citation chips. */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Ordered alternation. `exec` with the global flag walks left to right;
  // the alternation picks whichever token starts at the current scan
  // position. Code spans first so their contents aren't re-parsed.
  const re =
    /(`[^`]+`)|(\*\*[^*]+?\*\*)|(\[[^\]]+\]\([^)]+\))|(\[\d+\])|(\*[^*\s][^*]*?\*)|(_[^_\s][^_]*?_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("`")) {
      out.push(
        <code
          key={key}
          className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[0.85em] text-blue-200"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      out.push(
        <strong key={key} className="font-semibold text-[color:var(--foreground)]">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("[") && tok.includes("](")) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (mm && isSafeUrl(mm[2])) {
        out.push(
          <a
            key={key}
            href={mm[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 underline hover:text-blue-300"
          >
            {mm[1]}
          </a>,
        );
      } else if (mm) {
        // Unsafe scheme (javascript:/data:/vbscript:/…) — render the visible
        // link text only, never the clickable href.
        out.push(mm[1]);
      } else {
        out.push(tok);
      }
    } else if (CITATION.test(tok)) {
      const n = CITATION.exec(tok)![1];
      out.push(
        <sup
          key={key}
          className="mx-0.5 rounded bg-blue-500/20 px-1 text-[0.7em] font-medium text-blue-300"
          title={`Citation ${n} — see the citations panel below`}
        >
          {n}
        </sup>,
      );
    } else if (tok.startsWith("*") || tok.startsWith("_")) {
      out.push(
        <em key={key} className="italic">
          {tok.slice(1, -1)}
        </em>,
      );
    } else {
      out.push(tok);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Block-level parser: headings, lists, code fences, paragraphs. */
export function renderMarkdown(src: string): ReactNode {
  if (!src) return null;
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    if (/^```/.test(line.trim())) {
      const lang = line.trim().slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        body.push(lines[i]);
        i++;
      }
      i++; // consume closing fence (or EOF on a streaming partial)
      blocks.push(
        <pre
          key={`b${key++}`}
          className="my-2 overflow-x-auto rounded-md border border-[color:var(--border-soft)] bg-neutral-900/80 p-3 text-[0.8em] leading-relaxed"
        >
          <code className="font-mono text-neutral-200" data-lang={lang}>
            {body.join("\n")}
          </code>
        </pre>,
      );
      continue;
    }

    // Heading.
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const sizes = ["text-lg", "text-base", "text-base", "text-sm", "text-sm", "text-sm"];
      blocks.push(
        <p
          key={`b${key++}`}
          className={`mt-3 mb-1 font-semibold ${sizes[level - 1]} text-[color:var(--foreground)]`}
        >
          {renderInline(h[2], `h${key}`)}
        </p>,
      );
      i++;
      continue;
    }

    // Unordered list.
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={`b${key++}`} className="my-2 list-disc space-y-1 pl-5">
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, `ul${key}-${j}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={`b${key++}`} className="my-2 list-decimal space-y-1 pl-5">
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, `ol${key}-${j}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Blank line → skip (paragraph separator).
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph: gather consecutive plain lines.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```/.test(lines[i].trim()) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={`b${key++}`} className="my-1.5 whitespace-pre-wrap">
        {renderInline(para.join("\n"), `p${key}`)}
      </p>,
    );
  }

  return <div className="sar-markdown">{blocks}</div>;
}
