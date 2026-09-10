import type { DatabaseClient } from '../storage-backend.js'
import { generateId } from '../uuid.js'
import { readNativeTemplates, type NativeTemplate } from '../shard/native-core.js'
import { validateShardComponentRecord } from '../shard/schema-validator.js'

export interface TemplateCreateInput {
  name: string; content: string; description?: string | null; format?: string
  default_tags?: string[]; collection_id?: string | null
}

function validate(record: NativeTemplate): void {
  if (!validateShardComponentRecord('templates', record, 'full-v1', '2.0.0').valid) throw new Error('Invalid native template')
}

export class TemplatesRepository {
  constructor(private db: DatabaseClient) {}

  async get(id: string): Promise<NativeTemplate> {
    const row = (await readNativeTemplates(this.db, id))[0]
    if (!row) throw new Error(`Template not found: ${id}`)
    return row
  }

  async list(): Promise<NativeTemplate[]> { return readNativeTemplates(this.db) }

  async create(input: TemplateCreateInput): Promise<NativeTemplate> {
    const id = generateId()
    const now = new Date().toISOString()
    validate({ id, name: input.name, content: input.content, description: input.description ?? null, format: input.format ?? 'markdown',
      default_tags: input.default_tags ?? [], collection_id: input.collection_id ?? null, created_at: now, updated_at: now })
    await this.db.query(`INSERT INTO template (id, name, content, description, format, default_tags, collection_id)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [id, input.name, input.content, input.description ?? null, input.format ?? 'markdown', JSON.stringify(input.default_tags ?? []), input.collection_id ?? null])
    return this.get(id)
  }

  async update(id: string, input: Partial<TemplateCreateInput>): Promise<NativeTemplate> {
    const current = await this.get(id)
    validate({ ...current, ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) })
    const values: unknown[] = []
    const assignments = ['updated_at = now()']
    for (const key of ['name', 'content', 'description', 'format', 'default_tags', 'collection_id'] as const) {
      if (input[key] === undefined) continue
      values.push(key === 'default_tags' ? JSON.stringify(input[key]) : input[key])
      assignments.push(`${key} = $${values.length}${key === 'default_tags' ? '::jsonb' : ''}`)
    }
    values.push(id)
    await this.db.query(`UPDATE template SET ${assignments.join(', ')} WHERE id = $${values.length}`, values)
    return this.get(id)
  }

  async delete(id: string): Promise<void> { await this.db.query('DELETE FROM template WHERE id = $1', [id]) }
}
