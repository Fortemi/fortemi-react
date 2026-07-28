#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })

function nodeKey(node, sourceFile) {
  return printer.printNode(ts.EmitHint.Unspecified, node, sourceFile)
}

function sorted(nodes, sourceFile) {
  return [...nodes].sort((left, right) =>
    nodeKey(left, sourceFile).localeCompare(nodeKey(right, sourceFile)),
  )
}

export function canonicalizeDeclaration(sourceText, fileName = 'index.d.ts') {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const transformer = (context) => {
    const visit = (node) => {
      const visited = ts.visitEachChild(node, visit, context)
      if (
        ts.isTypeLiteralNode(visited)
        && visited.members.every(ts.isPropertySignature)
      ) {
        return ts.factory.updateTypeLiteralNode(
          visited,
          sorted(visited.members, sourceFile),
        )
      }
      if (ts.isUnionTypeNode(visited)) {
        return ts.factory.updateUnionTypeNode(
          visited,
          sorted(visited.types, sourceFile),
        )
      }
      return visited
    }
    return (root) => ts.visitNode(root, visit)
  }
  const transformed = ts.transform(sourceFile, [transformer])
  try {
    return printer.printFile(transformed.transformed[0])
  } finally {
    transformed.dispose()
  }
}

export function canonicalizeDeclarationFile(filePath) {
  const absolutePath = resolve(filePath)
  const canonical = canonicalizeDeclaration(
    readFileSync(absolutePath, 'utf8'),
    absolutePath,
  )
  writeFileSync(absolutePath, canonical)
}

export function main(args = process.argv.slice(2)) {
  if (args.length === 0) {
    throw new Error('Usage: canonicalize-declarations <file.d.ts> [...]')
  }
  for (const filePath of args) canonicalizeDeclarationFile(filePath)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
