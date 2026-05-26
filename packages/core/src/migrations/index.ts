import type { Migration } from '../migration-runner.js'
import { migration0001 } from './0001_initial_schema.js'
import { migration0002 } from './0002_skos_tagging.js'
import { migration0003 } from './0003_attachments.js'
import { migration0004 } from './0004_embeddings.js'
import { migration0005 } from './0005_link_confidence.js'
import { migration0006 } from './0006_embedding_set_metadata.js'
import { migration0007 } from './0007_virtual_embedding_sets.js'

export const allMigrations: Migration[] = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
  migration0006,
  migration0007,
]
