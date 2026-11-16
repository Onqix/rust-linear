import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Check, Copy } from "lucide-react";

interface MarkdownBodyProps {
  content: string;
  knownIdentifiers?: Set<string>;
  onSelectIdentifier?: (identifier: string) => void;
  className?: string;
}

const TICKET_REGEX = /\b([A-Z]{2,10}-\d+)\b/g;

function renderTextWithTicketChips(
  text: string,
  knownIdentifiers?: Set<string>,
  onSelectIdentifier?: (identifier: string) => void
): React.ReactNode {
  if (!onSelectIdentifier) return text;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(TICKET_REGEX.source, "g");

  while ((match = regex.exec(text)) !== null) {
    const id = match[1];
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const isKnown = !knownIdentifiers || knownIdentifiers.has(id.toUpperCase());
    if (isKnown) {
      parts.push(
        <button
          key={`${id}-${match.index}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelectIdentifier(id);
          }}
          className="mx-0.5 inline-flex items-center rounded border border-indigo-500/30 bg-indigo-500/15 px-1.5 py-0.5 font-mono text-[11px] font-medium text-indigo-300 transition hover:border-indigo-400/60 hover:bg-indigo-500/25 hover:text-indigo-200"
        >
          {id}
        </button>
      );
    } else {
      parts.push(id);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex === 0) return text;
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

function decorateChildren(
  children: React.ReactNode,
  knownIdentifiers?: Set<string>,
  onSelectIdentifier?: (identifier: string) => void
): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === "string") {
      return renderTextWithTicketChips(
        child,
        knownIdentifiers,
        onSelectIdentifier
      );
    }
    return child;
  });
}

function CodeBlock({
  language,
  code,
}: {
  language?: string;
  code: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard might be unavailable in restricted contexts
    }
  }

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-white/10 bg-[#07090D]">
      <div className="flex items-center justify-between border-b border-white/8 bg-white/[0.02] px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-zinc-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function MarkdownBody({
  content,
  knownIdentifiers,
  onSelectIdentifier,
  className = "",
}: MarkdownBodyProps) {
  return (
    <div className={`text-[13px] leading-relaxed text-zinc-300 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-4 mb-2 border-b border-white/8 pb-1 text-base font-semibold text-white first:mt-0">
              {decorateChildren(children, knownIdentifiers, onSelectIdentifier)}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-4 mb-2 text-sm font-semibold text-white first:mt-0">
              {decorateChildren(children, knownIdentifiers, onSelectIdentifier)}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-3 mb-1.5 text-[13px] font-semibold text-zinc-100 first:mt-0">
              {decorateChildren(children, knownIdentifiers, onSelectIdentifier)}
            </h3>
          ),
          p: ({ children }) => (
            <p className="mb-2.5 last:mb-0">
              {decorateChildren(children, knownIdentifiers, onSelectIdentifier)}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="mb-2.5 ml-4 list-disc space-y-1 marker:text-zinc-500 last:mb-0">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2.5 ml-4 list-decimal space-y-1 marker:text-zinc-500 last:mb-0">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="pl-0.5">
              {decorateChildren(children, knownIdentifiers, onSelectIdentifier)}
            </li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2.5 border-l-2 border-indigo-500/50 bg-indigo-500/[0.04] py-1 pl-3 text-zinc-300/90 italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-white/10" />,
          strong: ({ children }) => (
            <strong className="font-semibold text-zinc-100">
              {decorateChildren(children, knownIdentifiers, onSelectIdentifier)}
            </strong>
          ),
          em: ({ children }) => (
            <em className="italic text-zinc-200">
              {decorateChildren(children, knownIdentifiers, onSelectIdentifier)}
            </em>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) {
                  void openExternal(href).catch(() => {
                    window.open(href, "_blank", "noopener,noreferrer");
                  });
                }
              }}
              className="text-indigo-400 underline decoration-indigo-500/40 underline-offset-2 transition hover:text-indigo-300 hover:decoration-indigo-400"
            >
              {children}
            </a>
          ),
          code: ({ className: codeClassName, children }) => {
            const match = /language-(\w+)/.exec(codeClassName || "");
            const raw = String(children).replace(/\n$/, "");
            const isBlock = Boolean(match) || raw.includes("\n");
            if (isBlock) {
              return <CodeBlock language={match?.[1]} code={raw} />;
            }
            return (
              <code className="rounded border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11.5px] text-indigo-200">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <>{children}</>,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full border-collapse text-left text-xs">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-white/10 bg-white/[0.04] text-zinc-200">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 font-semibold">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border-t border-white/6 px-3 py-2 text-zinc-300">
              {decorateChildren(children, knownIdentifiers, onSelectIdentifier)}
            </td>
          ),
          input: ({ type, checked }) => {
            if (type === "checkbox") {
              return (
                <input
                  type="checkbox"
                  checked={Boolean(checked)}
                  readOnly
                  className="mr-1.5 h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-900 accent-indigo-500 align-middle"
                />
              );
            }
            return null;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
