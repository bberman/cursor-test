import { NextRequest, NextResponse } from "next/server";
import { parseArticleFromUrl } from "@/lib/article";
import { extractMusicReferences } from "@/lib/musicExtractor";
import { buildMusicDeepLinks } from "@/lib/deepLinks";

export const runtime = "nodejs";

interface ExtractRequestBody {
  url?: unknown;
}

function getErrorStatus(message: string): number {
  if (/request body|valid url|supported|non-empty/i.test(message)) {
    return 400;
  }

  if (/timed out/i.test(message)) {
    return 504;
  }

  if (/failed to fetch|did not return html|too large|empty html/i.test(message)) {
    return 502;
  }

  if (/could not extract|did not contain readable/i.test(message)) {
    return 422;
  }

  return 500;
}

function getBodyUrl(body: ExtractRequestBody): string {
  if (typeof body.url !== "string" || !body.url.trim()) {
    throw new Error("Request body must include a non-empty `url` string.");
  }
  return body.url.trim();
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as ExtractRequestBody;
    const sourceUrl = getBodyUrl(body);

    const article = await parseArticleFromUrl(sourceUrl);
    const extraction = extractMusicReferences(article.textContent);
    const songs = extraction.songs.map((song) => ({
      ...song,
      deepLinks: buildMusicDeepLinks(song)
    }));
    const albums = extraction.albums.map((album) => ({
      ...album,
      deepLinks: buildMusicDeepLinks(album)
    }));

    return NextResponse.json({
      article: {
        sourceUrl: article.sourceUrl,
        title: article.title,
        byline: article.byline,
        excerpt: article.excerpt,
        wordCount: article.textContent.split(/\s+/).filter(Boolean).length
      },
      songs,
      albums,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown extraction failure.";
    const status = getErrorStatus(message);

    return NextResponse.json(
      {
        error: message
      },
      { status }
    );
  }
}
