import type { DatabaseClient } from '../storage-backend.js'

export interface NoteTextWithAttachments {
  content: string
  extracted_text: string
  combined: string
}

export async function getNoteTextWithExtractedAttachments(
  db: DatabaseClient,
  noteId: string,
): Promise<NoteTextWithAttachments | null> {
  const result = await db.query<{ content: string; extracted_text: string | null }>(
    `SELECT c.content,
            COALESCE(string_agg(a.extracted_text, E'\n' ORDER BY a.position, a.created_at)
              FILTER (WHERE a.extracted_text IS NOT NULL AND a.extracted_text <> ''), '') as extracted_text
       FROM note_revised_current c
       LEFT JOIN attachment a ON a.note_id = c.note_id AND a.deleted_at IS NULL
       WHERE c.note_id = $1
       GROUP BY c.content`,
    [noteId],
  )
  if (result.rows.length === 0) return null
  const content = result.rows[0].content
  const extractedText = result.rows[0].extracted_text ?? ''
  return {
    content,
    extracted_text: extractedText,
    combined: [content, extractedText].filter(Boolean).join('\n'),
  }
}
