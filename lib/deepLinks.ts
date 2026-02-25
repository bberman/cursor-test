import type { MusicReferenceType } from "@/lib/musicExtractor";

export interface MusicDeepLinks {
  spotify: string;
  youtube: string;
}

interface BuildDeepLinksInput {
  type: MusicReferenceType;
  title: string;
  artist?: string;
}

function buildQueryParts(input: BuildDeepLinksInput): string[] {
  const parts = [input.artist, input.title].filter(
    (value): value is string => Boolean(value && value.trim())
  );
  parts.push(input.type === "song" ? "song" : "album");
  return parts;
}

export function buildMusicDeepLinks(input: BuildDeepLinksInput): MusicDeepLinks {
  const query = buildQueryParts(input).join(" ").trim();
  const encodedQuery = encodeURIComponent(query);

  return {
    spotify: `https://open.spotify.com/search/${encodedQuery}`,
    youtube: `https://www.youtube.com/results?search_query=${encodedQuery}`
  };
}
