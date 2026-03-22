import type { Migration } from '../migration-runner.js'
import { migration0001 } from './0001_initial_schema.js'

export const allMigrations: Migration[] = [
  migration0001,
]
