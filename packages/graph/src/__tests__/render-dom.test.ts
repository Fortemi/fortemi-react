import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderCommunityGraph } from '../render-dom.js'
import { colorForCommunity } from '../color.js'
import type { CommunityGraph } from '../types.js'

// ── Minimal fake DOM ─────────────────────────────────────────────────────────
// The graph package tests run in `environment: node`, so there is no document.
// This tiny stub implements exactly the DOM surface render-dom.ts uses, which
// also demonstrates the renderer is headless-safe (no browser, no rAF).
class FakeEl {
  attrs = new Map<string, string>()
  children: FakeEl[] = []
  listeners = new Map<string, Set<(e: unknown) => void>>()
  style: Record<string, string> = {}
  textContent = ''
  parent: FakeEl | null = null
  constructor(
    public tagName: string,
    public ownerDocument: FakeDoc,
  ) {}
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, String(v))
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null
  }
  appendChild(c: FakeEl): FakeEl {
    c.parent = this
    this.children.push(c)
    return c
  }
  replaceChildren(): void {
    for (const c of this.children) c.parent = null
    this.children = []
  }
  remove(): void {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((x) => x !== this)
      this.parent = null
    }
  }
  addEventListener(t: string, fn: (e: unknown) => void): void {
    let set = this.listeners.get(t)
    if (!set) this.listeners.set(t, (set = new Set()))
    set.add(fn)
  }
  removeEventListener(t: string, fn: (e: unknown) => void): void {
    this.listeners.get(t)?.delete(fn)
  }
  getBoundingClientRect(): { width: number; height: number } {
    return { width: 760, height: 460 }
  }
  // test helpers
  dispatch(type: string, extra: Record<string, unknown> = {}): void {
    const e = { type, target: this, stopPropagation() {}, preventDefault() {}, ...extra }
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e)
  }
  descendants(tag: string): FakeEl[] {
    const out: FakeEl[] = []
    const walk = (n: FakeEl): void => {
      if (n.tagName === tag) out.push(n)
      n.children.forEach(walk)
    }
    walk(this)
    return out
  }
}
class FakeDoc {
  defaultView = { getComputedStyle: () => ({ position: 'static' }) }
  createElementNS(_ns: string, tag: string): FakeEl {
    return new FakeEl(tag, this)
  }
  createElement(tag: string): FakeEl {
    return new FakeEl(tag, this)
  }
}

let doc: FakeDoc
let container: FakeEl
beforeEach(() => {
  doc = new FakeDoc()
  container = new FakeEl('div', doc)
  ;(globalThis as unknown as { document: FakeDoc }).document = doc
})
afterEach(() => {
  delete (globalThis as unknown as { document?: FakeDoc }).document
})

const GRAPH: CommunityGraph = {
  nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
  edges: [
    { source: 'a', target: 'b', weight: 1 },
    { source: 'b', target: 'c', weight: 2 },
    { source: 'c', target: 'd', weight: 1 },
  ],
  communities: [
    { id: 'c1', nodes: ['a', 'b'] },
    { id: 'c2', nodes: ['c', 'd'] },
  ],
}

function circleFor(svg: FakeEl, id: string): FakeEl {
  return svg.descendants('circle').find((c) => c.getAttribute('data-node-id') === id)!
}

describe('renderCommunityGraph (#259 JS-only SVG renderer)', () => {
  it('mounts an svg with a circle per node and a line per edge', () => {
    const handle = renderCommunityGraph(container as unknown as HTMLElement, GRAPH)
    const svg = handle.element as unknown as FakeEl
    expect(svg.tagName).toBe('svg')
    expect(svg.getAttribute('viewBox')).toBe('0 0 760 460')
    expect(svg.descendants('circle')).toHaveLength(4)
    expect(svg.descendants('line')).toHaveLength(3)
    expect(container.children).toContain(svg)
  })

  it('colors nodes with colorForCommunity and styles edges like GraphView', () => {
    const handle = renderCommunityGraph(container as unknown as HTMLElement, GRAPH)
    const svg = handle.element as unknown as FakeEl
    expect(circleFor(svg, 'a').getAttribute('fill')).toBe(colorForCommunity('c1'))
    expect(circleFor(svg, 'c').getAttribute('fill')).toBe(colorForCommunity('c2'))
    const line = svg.descendants('line')[0]
    expect(line.getAttribute('stroke')).toBe('#9aa0a6')
  })

  it('honors a community palette override', () => {
    const palette = ['#111111', '#222222']
    const handle = renderCommunityGraph(container as unknown as HTMLElement, GRAPH, {
      colors: palette,
    })
    const svg = handle.element as unknown as FakeEl
    expect(circleFor(svg, 'a').getAttribute('fill')).toBe(colorForCommunity('c1', palette))
  })

  it('applies the GraphViewFilters nodeIds allow-list', () => {
    const handle = renderCommunityGraph(container as unknown as HTMLElement, GRAPH, {
      filters: { nodeIds: ['a', 'b'] },
    })
    expect((handle.element as unknown as FakeEl).descendants('circle')).toHaveLength(2)
  })

  it('selects on click: emits onSelectNode, highlights, shows a labeled popup', () => {
    const onSelectNode = vi.fn()
    const handle = renderCommunityGraph(container as unknown as HTMLElement, GRAPH, {
      onSelectNode,
      labelFor: (id) => `Node ${id}`,
    })
    const svg = handle.element as unknown as FakeEl
    circleFor(svg, 'b').dispatch('click')
    expect(onSelectNode).toHaveBeenCalledWith('b')
    expect(circleFor(svg, 'b').getAttribute('stroke')).toBe('#111')
    const popup = container.children.find((c) => c.attrs.has('data-fortemi-graph-popup'))!
    expect(popup.style.display).toBe('block')
    expect(popup.textContent).toBe('Node b')
  })

  it('navigates on double-click and on Enter over an already-selected node', () => {
    const onNavigate = vi.fn()
    const handle = renderCommunityGraph(container as unknown as HTMLElement, GRAPH, { onNavigate })
    const svg = handle.element as unknown as FakeEl
    circleFor(svg, 'c').dispatch('dblclick')
    expect(onNavigate).toHaveBeenCalledWith('c')
    circleFor(svg, 'a').dispatch('click') // select a
    circleFor(svg, 'a').dispatch('keydown', { key: 'Enter' }) // Enter on selected → navigate
    expect(onNavigate).toHaveBeenCalledWith('a')
  })

  it('hover dims non-neighbors and restores on leave', () => {
    const handle = renderCommunityGraph(container as unknown as HTMLElement, GRAPH)
    const svg = handle.element as unknown as FakeEl
    circleFor(svg, 'b').dispatch('mouseenter') // b neighbors: a, c
    expect(circleFor(svg, 'a').style.opacity).toBe('1')
    expect(circleFor(svg, 'c').style.opacity).toBe('1')
    expect(circleFor(svg, 'd').style.opacity).toBe('0.15') // not a neighbor of b
    circleFor(svg, 'b').dispatch('mouseleave')
    expect(circleFor(svg, 'd').style.opacity).toBe('1')
  })

  it('honors the shared minDegree filter (drops leaf nodes)', () => {
    // a=1, b=2, c=2, d=1 → minDegree 2 keeps b, c
    const handle = renderCommunityGraph(container as unknown as HTMLElement, GRAPH, {
      filters: { minDegree: 2 },
    })
    expect((handle.element as unknown as FakeEl).descendants('circle')).toHaveLength(2)
  })

  it('update({filters}) relayouts to the new visible set', () => {
    const handle = renderCommunityGraph(container as unknown as HTMLElement, GRAPH)
    const svg = handle.element as unknown as FakeEl
    expect(svg.descendants('circle')).toHaveLength(4)
    handle.update({ filters: { communityIds: ['c1'] } })
    expect(svg.descendants('circle')).toHaveLength(2)
  })

  it('update({selectedNodeId}) selects without emitting onSelectNode', () => {
    const onSelectNode = vi.fn()
    const handle = renderCommunityGraph(container as unknown as HTMLElement, GRAPH, { onSelectNode })
    const svg = handle.element as unknown as FakeEl
    handle.update({ selectedNodeId: 'd' })
    expect(circleFor(svg, 'd').getAttribute('stroke')).toBe('#111')
    expect(onSelectNode).not.toHaveBeenCalled()
  })

  it('focus(id) centers and selects the node without emitting', () => {
    const onSelectNode = vi.fn()
    const handle = renderCommunityGraph(container as unknown as HTMLElement, GRAPH, { onSelectNode })
    const svg = handle.element as unknown as FakeEl
    const before = (svg.children[0] as FakeEl).getAttribute('transform')
    handle.focus('a')
    const after = (svg.children[0] as FakeEl).getAttribute('transform')
    expect(after).not.toBe(before)
    expect(circleFor(svg, 'a').getAttribute('stroke')).toBe('#111')
    expect(onSelectNode).not.toHaveBeenCalled()
  })

  it('is deterministic: two renders of the same graph produce identical geometry', () => {
    const h1 = renderCommunityGraph(container as unknown as HTMLElement, GRAPH)
    const c2 = new FakeEl('div', doc)
    const h2 = renderCommunityGraph(c2 as unknown as HTMLElement, GRAPH)
    const geom = (svg: FakeEl): string[] =>
      svg.descendants('circle').map((c) => `${c.getAttribute('cx')},${c.getAttribute('cy')}`)
    expect(geom(h1.element as unknown as FakeEl)).toEqual(geom(h2.element as unknown as FakeEl))
  })

  it('destroy() removes the svg and popup from the container', () => {
    const handle = renderCommunityGraph(container as unknown as HTMLElement, GRAPH)
    expect(container.children.length).toBe(2) // svg + popup
    handle.destroy()
    expect(container.children.length).toBe(0)
  })
})
