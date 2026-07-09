import type { Migration } from '../migration-runner.js'
import { migration0001 } from './0001_initial_schema.js'
import { migration0002 } from './0002_skos_tagging.js'
import { migration0003 } from './0003_attachments.js'
import { migration0004 } from './0004_embeddings.js'
import { migration0005 } from './0005_link_confidence.js'
import { migration0006 } from './0006_embedding_set_metadata.js'
import { migration0007 } from './0007_virtual_embedding_sets.js'
import { migration0008 } from './0008_graph_community_artifacts.js'
import { migration0009 } from './0009_vector_selector_performance.js'
import { migration0010 } from './0010_attachment_text_metadata.js'
import { migration0011 } from './0011_embedding_member_metadata.js'
import { migration0012 } from './0012_embedding_configs.js'
import { migration0013 } from './0013_templates.js'

export const allMigrations: Migration[] = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
  migration0006,
  migration0007,
  migration0008,
  migration0009,
  migration0010,
  migration0011,
  migration0012,
  migration0013,
]
