"use client";

import { FormEvent, useMemo, useState } from "react";

interface MusicReference {
  type: "song" | "album";
  title: string;
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

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export default function HomePage() {
  const [articleUrl, setArticleUrl] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ExtractionResponse | null>(null);

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

    try {
      const response = await fetch("/api/extract", {
        method: "POST",
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
      setErrorMessage(
        error instanceof Error ? error.message : "Unknown extraction error."
      );
    } finally {
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
              <strong>{item.title}</strong>
              <span className="chip">{formatConfidence(item.confidence)}</span>
              <p className="evidence">{item.evidence}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
