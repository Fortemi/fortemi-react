import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalizeDeclaration } from './canonicalize-declarations.mjs'

test('canonicalizes semantically unordered declaration members', () => {
  const left = `
    export type Input = {
      z?: string;
      a: "shared" | "private" | "public";
    };
  `
  const right = `
    export type Input = {
      a: "public" | "shared" | "private";
      z?: string;
    };
  `

  assert.equal(canonicalizeDeclaration(left), canonicalizeDeclaration(right))
})

test('preserves order-sensitive call signatures', () => {
  const source = `
    export type Overloaded = {
      (value: "specific"): 1;
      (value: string): 2;
    };
  `

  const canonical = canonicalizeDeclaration(source)
  assert(
    canonical.indexOf('(value: "specific"): 1')
      < canonical.indexOf('(value: string): 2'),
  )
})
