export type MusicReferenceType = "song" | "album";

export interface MusicReference {
  type: MusicReferenceType;
  title: string;
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

function normalizeTitle(raw: string): string {
  return raw
    .trim()
    .replace(/^[\s"'“”‘’.,:;!?()[\]-]+/, "")
    .replace(/[\s"'“”‘’.,:;!?()[\]-]+$/, "")
    .replace(/\s+/g, " ");
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

function getEvidence(text: string, index: number, radius = 110): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
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
  if (!existing || candidate.confidence > existing.confidence) {
    bucket.set(key, candidate);
  }
}

function fromQuotedMentions(text: string): MusicReference[] {
  const references: MusicReference[] = [];
  const quotedPattern = /(?:"|“|”)([^"“”\n]{2,120})(?:"|“|”)/g;

  for (const match of text.matchAll(quotedPattern)) {
    const raw = match[1] ?? "";
    const title = normalizeTitle(raw);
    const index = match.index ?? 0;

    if (!shouldKeepCandidate(title)) {
      continue;
    }

    const context = text
      .slice(Math.max(0, index - 120), Math.min(text.length, index + 120))
      .toLowerCase();

    const songScore = keywordHits(context, SONG_KEYWORDS);
    const albumScore = keywordHits(context, ALBUM_KEYWORDS);

    if (songScore === 0 && albumScore === 0) {
      continue;
    }

    const type: MusicReferenceType =
      songScore >= albumScore ? "song" : "album";
    const base = type === "song" ? songScore : albumScore;
    const confidence = Math.min(0.55 + base * 0.1, 0.95);

    references.push({
      type,
      title,
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

    references.push({
      type,
      title,
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
