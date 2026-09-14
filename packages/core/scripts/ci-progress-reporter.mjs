import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { renameSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'

// Diagnostic state only; final reports still own acceptance and coverage.
export default class ProgressReporter {
  constructor(options = {}) { this.output = options.output ?? process.env.FORTEMI_CI_PROGRESS }
  onInit(ctx) {
    assert.ok(this.output, 'Missing CI progress output')
    this.root = ctx.config.root
    this.state = { schema: 1, startedAt: new Date().toISOString(), phase: 'initialized', completedTests: 0, completedModules: 0, active: {} }
    writeFileSync(this.output, JSON.stringify(this.state) + '\n', { flag: 'wx', mode: 0o600 })
  }
  save() {
    this.state.updatedAt = new Date().toISOString()
    const bytes = JSON.stringify(this.state) + '\n'
    assert.ok(Buffer.byteLength(bytes) <= 64 * 1024, 'CI progress snapshot exceeds its bound')
    writeFileSync(this.output + '.tmp', bytes, { mode: 0o600 })
    renameSync(this.output + '.tmp', this.output)
  }
  file(entity) {
    const module = entity.module ?? entity
    const file = relative(this.root, module.moduleId)
    assert.ok(file && !file.startsWith('..') && file.length <= 512, 'Invalid CI progress module')
    return file.replaceAll('\\', '/')
  }
  update(entity, phase) {
    const file = this.file(entity)
    assert.ok(Object.hasOwn(this.state.active, file) || Object.keys(this.state.active).length < 16, 'Too many active CI modules')
    const name = entity.fullName ?? entity.name
    this.state.phase = 'running'
    this.state.active[file] = { phase, ...(name ? { name: name.slice(0, 512), nameSha256: createHash('sha256').update(name).digest('hex') } : {}) }
    this.save()
  }
  onTestModuleStart(module) { this.update(module, 'module-start') }
  onTestCaseReady(test) { this.update(test, 'case-ready') }
  onTestCaseResult(test) {
    this.state.completedTests++
    this.update(test, 'case-' + test.result().state)
  }
  onHookStart({ entity, name }) { this.update(entity, name + '-start') }
  onHookEnd({ entity, name }) { this.update(entity, name + '-end') }
  onTestModuleEnd(module) {
    const file = this.file(module)
    this.state.lastCompletedModule = file
    delete this.state.active[file]
    this.state.completedModules++
    this.save()
  }
  onTestRunEnd(_modules, _errors, reason) {
    this.state.phase = reason
    this.save()
  }
}
