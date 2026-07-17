import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const receiptPath = resolve(packageRoot, 'schemas/knowledge-shard.schema.receipt.json')
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function verifyBundle(bundle, label) {
  const aggregate = createHash('sha256')
  for (const [relativePath, expected] of Object.entries(bundle.files).sort(([left], [right]) =>
    left.localeCompare(right))) {
    const bytes = readFileSync(resolve(packageRoot, bundle.vendoredRoot, relativePath))
    const actual = sha256(bytes)
    if (actual !== expected) {
      throw new Error(`${label} digest drift: ${relativePath}; expected ${expected}, got ${actual}`)
    }
    aggregate.update(bytes)
  }
  const actualAggregate = aggregate.digest('hex')
  if (actualAggregate !== bundle.sha256) {
    throw new Error(`${label} aggregate drift: expected ${bundle.sha256}, got ${actualAggregate}`)
  }
}

const upstreamContract = readFileSync(
  resolve(packageRoot, 'schemas/knowledge-shard/upstream-contract.json'),
)
const upstreamContractSha = sha256(upstreamContract)
if (upstreamContractSha !== receipt.source.contractSha256) {
  throw new Error(
    `upstream contract drift: expected ${receipt.source.contractSha256}, got ${upstreamContractSha}`,
  )
}

verifyBundle(receipt.schemaBundle, 'schema bundle')
verifyBundle(receipt.goldenCorpus, 'golden corpus')

console.log(
  `Knowledge Shard ${receipt.knowledgeShard.schemaVersion}/${receipt.knowledgeShard.profile}: ` +
    `${receipt.source.commit} ${receipt.schemaBundle.sha256}`,
)
