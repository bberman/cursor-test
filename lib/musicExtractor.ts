export type MusicReferenceType = "song" | "album";

export interface MusicReference {
  type: MusicReferenceType;
  title: string;
  artist?: string;
  confidence: number;
  evidence: string;
}

export interface MusicExtractionResult {
  songs: MusicReference[];
  albums: MusicReference[];
}

const SONG_KEYWORDS = [
  "song",
  "songs",
  "track",
  "tracks",
  "single",
  "anthem",
  "ballad",
  "jam"
];

const ALBUM_KEYWORDS = [
  "album",
  "albums",
  "record",
  "records",
  "lp",
  "ep",
  "debut",
  "discography"
];

const IGNORE_TITLES = new Set([
  "read more",
  "click here",
  "learn more",
  "sign up",
  "newsletter",
  "spotify",
  "apple music",
  "youtube"
]);

const IGNORE_ARTISTS = new Set([
  "npr",
  "spotify",
  "apple music",
  "youtube",
  "tiktok",
  "billboard",
  "grammys"
]);

const CONNECTOR_WORDS = new Set(["and", "&", "the", "of", "with", "feat.", "ft."]);

function normalizeTitle(raw: string): string {
  return raw
    .trim()
    .replace(/^[\s"'“”‘’.,:;!?()[\]-]+/, "")
    .replace(/[\s"'“”‘’.,:;!?()[\]-]+$/, "")
    .replace(/\s+/g, " ");
}

function normalizeArtist(raw: string): string {
  return raw
    .trim()
    .replace(/^by\s+/i, "")
    .replace(/^[\s"'“”‘’.,:;!?()[\]-]+/, "")
    .replace(/[\s"'“”‘’.,:;!?()[\]-]+$/, "")
    .replace(/\s+/g, " ");
}

function splitArtistAndTitleFromCandidate(raw: string): {
  title: string;
  artist?: string;
} {
  const normalized = normalizeTitle(raw);
  const splitMatch = normalized.match(/^(.{1,60})\s[-–—]\s(.{1,90})$/);
  if (!splitMatch) {
    return { title: normalized };
  }

  const left = normalizeArtist(splitMatch[1]);
  const right = normalizeTitle(splitMatch[2]);

  if (shouldKeepArtistCandidate(left) && shouldKeepCandidate(right)) {
    return { title: right, artist: left };
  }

  return { title: normalized };
}

function isMostlyTitleCase(value: string): boolean {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return false;
  }

  let titleCaseWords = 0;
  for (const word of words) {
    if (/^[A-Z0-9]/.test(word)) {
      titleCaseWords += 1;
    }
  }
  return titleCaseWords / words.length >= 0.5;
}

function hasLikelyArtistCasing(value: string): boolean {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return false;
  }

  let validWords = 0;
  for (const word of words) {
    const lower = word.toLowerCase();
    if (CONNECTOR_WORDS.has(lower)) {
      validWords += 1;
      continue;
    }

    if (/^[A-Z0-9]/.test(word)) {
      validWords += 1;
    }
  }

  return validWords / words.length >= 0.75;
}

function shouldKeepCandidate(value: string): boolean {
  const title = normalizeTitle(value);
  if (!title) {
    return false;
  }
  if (title.length < 2 || title.length > 90) {
    return false;
  }

  const lower = title.toLowerCase();
  if (IGNORE_TITLES.has(lower)) {
    return false;
  }

  const words = title.split(/\s+/);
  if (words.length > 10) {
    return false;
  }

  if (!/[A-Za-z]/.test(title)) {
    return false;
  }

  return isMostlyTitleCase(title);
}

function shouldKeepArtistCandidate(value: string): boolean {
  const artist = normalizeArtist(value);
  if (!artist) {
    return false;
  }

  if (artist.length < 2 || artist.length > 60) {
    return false;
  }

  const lower = artist.toLowerCase();
  if (IGNORE_ARTISTS.has(lower)) {
    return false;
  }

  const words = artist.split(/\s+/);
  if (words.length > 6) {
    return false;
  }

  if (!/[A-Za-z]/.test(artist)) {
    return false;
  }

  if (/\b(song|album|record|track|single)\b/i.test(artist)) {
    return false;
  }

  return hasLikelyArtistCasing(artist);
}

function getEvidence(text: string, index: number, radius = 110): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractArtistFromContext(title: string, context: string): string | undefined {
  const escapedTitle = escapeForRegex(title);
  const artistPatterns = [
    new RegExp(
      `["“”']?${escapedTitle}["“”']?\\s+by\\s+([A-Z][A-Za-z0-9&'’.\\-]*(?:\\s+[A-Za-z0-9&'’.\\-]+){0,5})`,
      "i"
    ),
    new RegExp(
      `([A-Z][A-Za-z0-9&'’.\\-]*(?:\\s+[A-Za-z0-9&'’.\\-]+){0,5})['’]s\\s+["“”']?${escapedTitle}["“”']?`,
      "i"
    ),
    new RegExp(
      `by\\s+([A-Z][A-Za-z0-9&'’.\\-]*(?:\\s+[A-Za-z0-9&'’.\\-]+){0,5})[^.!?]{0,60}["“”']?${escapedTitle}["“”']?`,
      "i"
    )
  ];

  for (const pattern of artistPatterns) {
    const match = context.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const artist = normalizeArtist(match[1]);
    if (shouldKeepArtistCandidate(artist)) {
      return artist;
    }
  }

  return undefined;
}

function keywordHits(context: string, keywords: string[]): number {
  return keywords.reduce((count, keyword) => {
    return count + (context.includes(keyword) ? 1 : 0);
  }, 0);
}

function addReference(
  bucket: Map<string, MusicReference>,
  candidate: MusicReference
): void {
  const key = `${candidate.type}:${candidate.title.toLowerCase()}`;
  const existing = bucket.get(key);
  if (!existing) {
    bucket.set(key, candidate);
    return;
  }

  if (candidate.confidence > existing.confidence) {
    bucket.set(key, {
      ...candidate,
      artist: candidate.artist ?? existing.artist
    });
    return;
  }

  if (!existing.artist && candidate.artist) {
    bucket.set(key, {
      ...existing,
      artist: candidate.artist
    });
  }
}

function fromQuotedMentions(text: string): MusicReference[] {
  const references: MusicReference[] = [];
  const quotedPattern = /(?:"|“|”)([^"“”\n]{2,120})(?:"|“|”)/g;

  for (const match of text.matchAll(quotedPattern)) {
    const raw = match[1] ?? "";
    const parsed = splitArtistAndTitleFromCandidate(raw);
    const title = parsed.title;
    const index = match.index ?? 0;

    if (!shouldKeepCandidate(title)) {
      continue;
    }

    const classificationContext = text
      .slice(Math.max(0, index - 120), Math.min(text.length, index + 120))
      .toLowerCase();

    const songScore = keywordHits(classificationContext, SONG_KEYWORDS);
    const albumScore = keywordHits(classificationContext, ALBUM_KEYWORDS);

    if (songScore === 0 && albumScore === 0) {
      continue;
    }

    const type: MusicReferenceType =
      songScore >= albumScore ? "song" : "album";
    const base = type === "song" ? songScore : albumScore;
    const confidence = Math.min(0.55 + base * 0.1, 0.95);
    const artistContext = getEvidence(text, index, 220);
    const artist =
      parsed.artist ?? extractArtistFromContext(title, artistContext);

    references.push({
      type,
      title,
      artist,
      confidence,
      evidence: getEvidence(text, index)
    });
  }

  return references;
}

function extractByPattern(
  text: string,
  pattern: RegExp,
  type: MusicReferenceType,
  confidence: number
): MusicReference[] {
  const references: MusicReference[] = [];

  for (const match of text.matchAll(pattern)) {
    const raw = match[1] ?? "";
    const title = normalizeTitle(raw);
    const index = match.index ?? 0;

    if (!shouldKeepCandidate(title)) {
      continue;
    }

    const context = getEvidence(text, index, 220);
    const artist = extractArtistFromContext(title, context);

    references.push({
      type,
      title,
      artist,
      confidence,
      evidence: getEvidence(text, index)
    });
  }

  return references;
}

function sortByConfidenceDesc(left: MusicReference, right: MusicReference): number {
  return right.confidence - left.confidence || left.title.localeCompare(right.title);
}

export function extractMusicReferences(text: string): MusicExtractionResult {
  const cleanedText = text.replace(/\s+/g, " ").trim();
  const references = new Map<string, MusicReference>();

  const titlePattern =
    '([A-Z][A-Za-z0-9&\'".:!?()\\-]*(?:\\s+[A-Z0-9][A-Za-z0-9&\'".:!?()\\-]*){0,7})';
  const songPattern = new RegExp(
    `\\b(?:song|track|single|anthem|ballad)\\s+(?:called|titled|named)?\\s*["“”']?${titlePattern}`,
    "g"
  );
  const albumPattern = new RegExp(
    `\\b(?:album|record|lp|ep)\\s+(?:called|titled|named)?\\s*["“”']?${titlePattern}`,
    "g"
  );

  const candidates = [
    ...fromQuotedMentions(cleanedText),
    ...extractByPattern(cleanedText, songPattern, "song", 0.83),
    ...extractByPattern(cleanedText, albumPattern, "album", 0.83)
  ];

  for (const candidate of candidates) {
    addReference(references, candidate);
  }

  const songs = [...references.values()]
    .filter((item) => item.type === "song")
    .sort(sortByConfidenceDesc);

  const albums = [...references.values()]
    .filter((item) => item.type === "album")
    .sort(sortByConfidenceDesc);

  return { songs, albums };
}
