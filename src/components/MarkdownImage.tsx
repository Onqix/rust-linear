import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { ImageOff, Loader2, X } from "lucide-react";
import { openExternalUrl } from "../lib/openExternal";

// Linear uploads need the API key, so they're fetched by the backend and cached as data URLs.
const cache = new Map<string, Promise<string>>();

function isLinearUpload(src: string): boolean {
  try {
    const u = new URL(src);
    return u.protocol === "https:" && u.hostname === "uploads.linear.app";
  } catch {
    return false;
  }
}

function loadLinearImage(src: string): Promise<string> {
  let p = cache.get(src);
  if (!p) {
    p = invoke<string>("fetch_linear_image", { url: src });
    p.catch(() => cache.delete(src));
    cache.set(src, p);
  }
  return p;
}

export function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const needsFetch = Boolean(src && isLinearUpload(src));
  const [resolved, setResolved] = useState<string | null>(
    src && !needsFetch ? src : null
  );
  const [error, setError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!src) return;
    if (!needsFetch) {
      setResolved(src);
      return;
    }
    let active = true;
    setResolved(null);
    setError(null);
    loadLinearImage(src)
      .then((url) => active && setResolved(url))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [src, needsFetch]);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoomed(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);

  if (!src) return null;

  if (error) {
    return (
      <button
        type="button"
        title={error}
        onClick={(e) => {
          e.stopPropagation();
          void openExternalUrl(src);
        }}
        className="my-1 inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-600 hover:border-indigo-300 hover:text-zinc-900 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300"
      >
        <ImageOff className="h-3.5 w-3.5" />
        {alt?.trim() || "Image"} couldn't load: open it
      </button>
    );
  }

  if (!resolved) {
    return (
      <span className="my-1 inline-flex h-24 w-40 items-center justify-center rounded-md border border-dashed border-zinc-300 text-zinc-400 dark:border-white/12 dark:text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" />
      </span>
    );
  }

  return (
    <>
      <img
        src={resolved}
        alt={alt ?? ""}
        title={alt || undefined}
        onClick={(e) => {
          e.stopPropagation();
          setZoomed(true);
        }}
        onError={() => setError("The image failed to render.")}
        className="my-1.5 block max-h-96 max-w-full cursor-zoom-in rounded-md border border-zinc-200 dark:border-white/10"
      />
      {zoomed &&
        createPortal(
          <div
            role="dialog"
            aria-label={alt || "Image"}
            onClick={() => setZoomed(false)}
            className="fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-black/80 p-6"
          >
            <img
              src={resolved}
              alt={alt ?? ""}
              className="max-h-full max-w-full rounded-md shadow-2xl"
            />
            <button
              type="button"
              aria-label="Close"
              onClick={() => setZoomed(false)}
              className="absolute right-4 top-4 rounded-full bg-white/10 p-1.5 text-white hover:bg-white/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>,
          document.body
        )}
    </>
  );
}
