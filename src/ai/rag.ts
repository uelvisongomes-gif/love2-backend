// RAG stub — returns no hits until embeddings are enabled (Voyage/OpenAI + Source table).
// Interface is the final one; when the real implementation lands, only the two
// function bodies below change; consumers stay identical.

export interface SourceRow {
  id: string;
  pillar: string;
  title: string;
  url: string;
  content: string;
  createdAt: Date;
}

export interface RagHit {
  source: SourceRow;
  similarity: number;
}

export interface IngestSourceInput {
  pillar: string;
  title: string;
  url: string;
  content: string;
}

export async function ingestSource(_input: IngestSourceInput): Promise<{ id: string }> {
  throw new Error('RAG ingest not enabled — configure EMBEDDING_PROVIDER + Source table first');
}

export async function searchRag(
  _query: string,
  _opts: { pillar?: string; k?: number } = {},
): Promise<RagHit[]> {
  return [];
}

export function formatCitation(s: SourceRow): string {
  return `Fonte: ${s.title} — ${s.url}`;
}
