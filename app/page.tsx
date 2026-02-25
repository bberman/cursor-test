"use client";

import { FormEvent, useMemo, useState } from "react";

interface MusicReference {
  type: "song" | "album";
  title: string;
  artist?: string;
  confidence: number;
  evidence: string;
}

interface ExtractionResponse {
  article: {
    sourceUrl: string;
    title: string;
    byline: string;
    excerpt: string;
    wordCount: number;
  };
  songs: MusicReference[];
  albums: MusicReference[];
  generatedAt: string;
}

const CLIENT_TIMEOUT_MS = 25_000;

function isErrorPayload(value: unknown): value is { error: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: unknown }).error === "string"
  );
}

function isExtractionResponse(value: unknown): value is ExtractionResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ExtractionResponse>;
  return (
    typeof candidate.generatedAt === "string" &&
    Array.isArray(candidate.songs) &&
    Array.isArray(candidate.albums) &&
    typeof candidate.article?.title === "string"
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function formatDuration(durationMs: number): string {
  const seconds = durationMs / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

function formatReferenceDisplay(item: MusicReference): string {
  if (item.type === "song") {
    return `${item.artist ?? "Unknown Artist"} - ${item.title}`;
  }

  return item.title;
}

export default function HomePage() {
  const [articleUrl, setArticleUrl] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ExtractionResponse | null>(null);
  const [lastDurationMs, setLastDurationMs] = useState<number | null>(null);

  const totalMatches = useMemo(() => {
    if (!result) {
      return 0;
    }
    return result.songs.length + result.albums.length;
  }, [result]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage("");
    setResult(null);
    setIsLoading(true);
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, CLIENT_TIMEOUT_MS);

    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ url: articleUrl })
      });

      const payload: unknown = await response.json();

      if (!response.ok) {
        const message = isErrorPayload(payload)
          ? payload.error
          : "Extraction request failed.";
        throw new Error(message);
      }

      if (!isExtractionResponse(payload)) {
        throw new Error("Received an invalid extraction response.");
      }

      setResult(payload);
    } catch (error) {
      const timeoutMessage = `Request timed out after ${Math.round(
        CLIENT_TIMEOUT_MS / 1000
      )} seconds. Some publisher sites block automated fetching; try another article URL or rerun.`;
      setErrorMessage(
        isAbortError(error)
          ? timeoutMessage
          : error instanceof Error
            ? error.message
            : "Unknown extraction error."
      );
    } finally {
      window.clearTimeout(timeoutId);
      setLastDurationMs(Math.round(performance.now() - startedAt));
      setIsLoading(false);
    }
  }

  return (
    <main className="page">
      <section className="panel">
        <h1>Music Article Extractor - Phase 0</h1>
        <p>
          Paste a music article URL and this MVP will extract candidate songs
          and albums.
        </p>
        <form onSubmit={handleSubmit} className="form">
          <label htmlFor="article-url">Article URL</label>
          <div className="row">
            <input
              id="article-url"
              type="url"
              value={articleUrl}
              onChange={(event) => setArticleUrl(event.target.value)}
              placeholder="https://example.com/music-article"
              required
            />
            <button type="submit" disabled={isLoading}>
              {isLoading ? "Extracting..." : "Extract"}
            </button>
          </div>
        </form>
        <p className="hint">
          Most articles finish in 2-10 seconds. This request auto-times out
          after {Math.round(CLIENT_TIMEOUT_MS / 1000)} seconds.
        </p>
        {lastDurationMs !== null ? (
          <p className="muted">Last request took {formatDuration(lastDurationMs)}.</p>
        ) : null}
        {errorMessage ? <p className="error">{errorMessage}</p> : null}
      </section>

      {result ? (
        <section className="panel">
          <h2>{result.article.title}</h2>
          <p className="muted">
            {result.article.byline ? `${result.article.byline} - ` : ""}
            {result.article.wordCount} words - {totalMatches} references found
          </p>
          <p className="excerpt">{result.article.excerpt}</p>
          <p className="muted">
            Source:{" "}
            <a href={result.article.sourceUrl} target="_blank" rel="noreferrer">
              {result.article.sourceUrl}
            </a>
          </p>

          <div className="resultsGrid">
            <ResultList title="Songs" items={result.songs} emptyText="No songs found." />
            <ResultList
              title="Albums"
              items={result.albums}
              emptyText="No albums found."
            />
          </div>
        </section>
      ) : null}
    </main>
  );
}

function ResultList({
  title,
  items,
  emptyText
}: {
  title: string;
  items: MusicReference[];
  emptyText: string;
}) {
  return (
    <div className="resultsList">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={`${item.type}-${item.title}`}>
              <strong>{formatReferenceDisplay(item)}</strong>
              <span className="chip">{formatConfidence(item.confidence)}</span>
              <p className="evidence">{item.evidence}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
