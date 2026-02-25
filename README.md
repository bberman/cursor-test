# Music Article Extractor (Phase 0 MVP)

Phase 0 implementation for extracting songs and albums mentioned in music
articles.

## What this does

- Accepts a URL to an article
- Fetches the article HTML
- Uses Mozilla Readability to isolate article content
- Extracts likely songs and albums with heuristic confidence scores
- Attempts to infer artist names when possible
- Adds Spotify and YouTube search deep links for each extracted item
- Displays results in a simple web UI

## Tech stack

- Next.js (App Router) + TypeScript
- `@mozilla/readability` + `jsdom` for article parsing

## Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

## API

`POST /api/extract`

Request body:

```json
{
  "url": "https://example.com/some-music-article"
}
```

Response body:

```json
{
  "article": {
    "sourceUrl": "https://example.com/some-music-article",
    "title": "Article title",
    "byline": "Author",
    "excerpt": "Short excerpt...",
    "wordCount": 1234
  },
  "songs": [
    {
      "type": "song",
      "artist": "Artist Name",
      "title": "Song Name",
      "confidence": 0.83,
      "evidence": "...",
      "deepLinks": {
        "spotify": "https://open.spotify.com/search/Artist%20Name%20Song%20Name%20song",
        "youtube": "https://www.youtube.com/results?search_query=Artist%20Name%20Song%20Name%20song"
      }
    }
  ],
  "albums": [],
  "generatedAt": "2026-02-25T00:00:00.000Z"
}
```

## Notes

- This is intentionally deterministic and keyless for fast MVP iteration.
- Most extractions complete in a few seconds.
- API fetches automatically time out after ~15s; the UI times out after ~25s.
- Some sites block bots or return non-HTML; if fetch fails, try another article URL.
