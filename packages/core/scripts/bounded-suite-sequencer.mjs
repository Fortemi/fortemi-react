import { relative } from 'node:path'
import { BaseSequencer } from 'vitest/node'

const expensive = [
  'src/__tests__/shard/native-full-v1-presence.test.ts',
  'src/__tests__/shard/native-full-v1-public.test.ts',
]

export class BoundedSuiteSequencer extends BaseSequencer {
  async sort(files) {
    const ordered = await super.sort(files)
    const groups = []
    for (const spec of ordered) {
      if (groups.at(-1)?.[0].project !== spec.project) groups.push([])
      groups.at(-1).push(spec)
    }
    const priority = (spec) => {
      const index = expensive.indexOf(relative(this.ctx.config.root, spec.moduleId).replaceAll('\\', '/'))
      return index < 0 ? expensive.length : index
    }
    // Start measured long suites early; keep default project order and shard ownership.
    return groups.flatMap(group => group.sort((a, b) => priority(a) - priority(b)))
  }
}
