import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export interface ParsedArticle {
  sourceUrl: string;
  title: string;
  byline: string;
  excerpt: string;
  textContent: string;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function fallbackFromBody(html: string): {
  title: string;
  byline: string;
  excerpt: string;
  textContent: string;
} {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const title = normalizeWhitespace(document.title || "Untitled article");
  const bodyText = normalizeWhitespace(document.body?.textContent || "");

  return {
    title,
    byline: "",
    excerpt: bodyText.slice(0, 220),
    textContent: bodyText
  };
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

  const response = await fetch(parsedUrl.toString(), {
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
      `Failed to fetch article. Received status code ${response.status}.`
    );
  }

  const html = await response.text();

  const dom = new JSDOM(html, { url: parsedUrl.toString() });
  const readability = new Readability(dom.window.document);
  const article = readability.parse();

  if (!article) {
    const fallback = fallbackFromBody(html);

    if (!fallback.textContent) {
      throw new Error("Could not extract readable article text from this URL.");
    }

    return {
      sourceUrl: parsedUrl.toString(),
      ...fallback
    };
  }

  const textContent = normalizeWhitespace(article.textContent || "");

  if (!textContent) {
    throw new Error("Article was fetched but did not contain readable text.");
  }

  return {
    sourceUrl: parsedUrl.toString(),
    title: normalizeWhitespace(article.title || "Untitled article"),
    byline: normalizeWhitespace(article.byline || ""),
    excerpt: normalizeWhitespace(article.excerpt || textContent.slice(0, 220)),
    textContent
  };
}
