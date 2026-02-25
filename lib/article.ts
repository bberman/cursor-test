import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export interface ParsedArticle {
  sourceUrl: string;
  title: string;
  byline: string;
  excerpt: string;
  textContent: string;
}

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 2_500_000;
const HTML_CONTENT_TYPE_PATTERN = /(text\/html|application\/xhtml\+xml)/i;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function fallbackFromDocument(document: Document): {
  title: string;
  byline: string;
  excerpt: string;
  textContent: string;
} {
  const title = normalizeWhitespace(document.title || "Untitled article");
  const bodyText = normalizeWhitespace(document.body?.textContent || "");

  return {
    title,
    byline: "",
    excerpt: bodyText.slice(0, 220),
    textContent: bodyText
  };
}

function sanitizeHtmlForParsing(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
}

async function readResponseBodyWithLimit(
  response: Response,
  maxBytes: number
): Promise<string> {
  if (!response.body) {
    const fallbackText = await response.text();
    if (fallbackText.length > maxBytes) {
      throw new Error("Article HTML is too large to parse reliably.");
    }
    return fallbackText;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let html = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      await reader.cancel();
      throw new Error(
        `Article HTML is too large (>${Math.round(maxBytes / 1_000_000)}MB).`
      );
    }

    html += decoder.decode(value, { stream: true });
  }

  html += decoder.decode();
  return html;
}

export async function parseArticleFromUrl(url: string): Promise<ParsedArticle> {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Please provide a valid URL.");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Only http/https URLs are supported.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let html = "";

  try {
    const response = await fetch(parsedUrl.toString(), {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; MusicArticleExtractor/0.1; +https://example.com/bot)",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9"
      }
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch article (status ${response.status}). The site may block automated requests.`
      );
    }

    const contentType = response.headers.get("content-type");
    if (contentType && !HTML_CONTENT_TYPE_PATTERN.test(contentType)) {
      throw new Error(
        `URL did not return HTML content (content-type: ${contentType}).`
      );
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_HTML_BYTES) {
      throw new Error(
        `Article HTML is too large (>${Math.round(MAX_HTML_BYTES / 1_000_000)}MB).`
      );
    }

    html = await readResponseBodyWithLimit(response, MAX_HTML_BYTES);
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(
        `Timed out while fetching article after ${Math.round(FETCH_TIMEOUT_MS / 1000)} seconds.`
      );
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Failed to fetch article content.");
  } finally {
    clearTimeout(timeout);
  }

  if (!html.trim()) {
    throw new Error("Article fetch returned empty HTML.");
  }

  const sanitizedHtml = sanitizeHtmlForParsing(html);
  const dom = new JSDOM(sanitizedHtml, { url: parsedUrl.toString() });

  try {
    const document = dom.window.document;
    const readability = new Readability(document);
    const article = readability.parse();
    const fallback = fallbackFromDocument(document);

    const readableText = normalizeWhitespace(article?.textContent || "");
    const textContent = readableText || fallback.textContent;

    if (!textContent) {
      throw new Error("Could not extract readable article text from this URL.");
    }

    return {
      sourceUrl: parsedUrl.toString(),
      title: normalizeWhitespace(article?.title || fallback.title),
      byline: normalizeWhitespace(article?.byline || fallback.byline),
      excerpt: normalizeWhitespace(
        article?.excerpt || fallback.excerpt || textContent.slice(0, 220)
      ),
      textContent
    };
  } finally {
    dom.window.close();
  }
}
