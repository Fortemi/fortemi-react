import type { Migration } from '../migration-runner.js'
import { migration0001 } from './0001_initial_schema.js'
import { migration0002 } from './0002_skos_tagging.js'
import { migration0003 } from './0003_attachments.js'
import { migration0004 } from './0004_embeddings.js'
import { migration0005 } from './0005_link_confidence.js'

export const allMigrations: Migration[] = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
]
