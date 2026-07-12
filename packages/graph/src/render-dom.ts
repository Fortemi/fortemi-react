// Framework-agnostic DOM/SVG renderer for a CommunityGraph (#259).
//
// A batteries-included, dependency-free renderer that turns a CommunityGraph
// into an interactive SVG view, reusing the engine (layoutCommunityGraph,
// colorForCommunity, applyControlFilters, buildAdjacency) so it stays visually
// identical to @fortemi/react's `GraphView`. No React, no sigma/graphology.
//
// Deterministic + headless-safe: layout is synchronous and seeded, and the DOM
// is built without animation frames, so it renders identically in a browser,
// jsdom, or an SSR-style document and can back static snapshots.

import { colorForCommunity } from './color.js'
import { applyControlFilters, type GraphControlContract, type GraphControlFilters } from './contract.js'
import { layoutCommunityGraph, type LayoutOptions } from './layout.js'
import { computeGraphBounds, fitGraphToViewport } from './bounds.js'
import { buildAdjacency } from './neighborhood.js'
import type { CommunityGraph, GraphLayoutAlgorithm, PositionedGraph } from './types.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Filter shape accepted by the renderer — the shared control-filter contract. */
export type GraphRenderFilters = GraphControlFilters

/**
 * Options for {@link renderCommunityGraph}. Extends the shared
 * {@link GraphControlContract} (algorithm, filters, selection, navigation,
 * labels, colors, size — honored by every renderer tier) with renderer-specific
 * knobs. The React `GraphView` honors the same contract, so the tiers are
 * drop-in swappable.
 */
export interface GraphRenderOptions extends GraphControlContract {
  /** Extra layout tuning forwarded to `layoutCommunityGraph`. */
  layoutOptions?: Omit<LayoutOptions, 'algorithm' | 'width' | 'height'>
  /** Canvas background. Default `#fafafa`. */
  background?: string
  /** Enable zoom/pan/hover interactions. Default `true`. */
  interactive?: boolean
  /** Zoom clamp. Default 0.4 / 3. */
  minScale?: number
  maxScale?: number
}

/** Mutable subset applied via {@link GraphRenderHandle.update}. */
export type GraphRenderUpdate = Partial<
  Pick<GraphRenderOptions, 'filters' | 'algorithm' | 'selectedNodeId' | 'labelFor'>
> & { graph?: CommunityGraph }

/** Live handle returned by {@link renderCommunityGraph}. */
export interface GraphRenderHandle {
  /** Apply new graph/filters/algorithm/selection without recreating the view. */
  update(next: GraphRenderUpdate): void
  /** Select and center a node (search/focus). Pass `null` to clear selection. */
  focus(nodeId: string | null): void
  /** Remove the view, its popup, and all listeners from the container. */
  destroy(): void
  /** The mounted `<svg>` element. */
  readonly element: SVGSVGElement
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  return node
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Render `graph` into `container` as an interactive SVG community graph.
 * Returns a {@link GraphRenderHandle}; call `destroy()` to tear it down.
 */
export function renderCommunityGraph(
  container: HTMLElement,
  graph: CommunityGraph,
  options: GraphRenderOptions = {},
): GraphRenderHandle {
  const width = options.width ?? 760
  const height = options.height ?? 460
  const background = options.background ?? '#fafafa'
  const interactive = options.interactive ?? true
  const minScale = options.minScale ?? 0.4
  const maxScale = options.maxScale ?? 3

  // ── mutable state ─────────────────────────────────────────────────────────
  let currentGraph = graph
  let filters = options.filters
  let algorithm: GraphLayoutAlgorithm = options.algorithm ?? 'force'
  let selectedNodeId = options.selectedNodeId ?? null
  let labelFor = options.labelFor ?? ((id: string) => id)

  let visible: CommunityGraph = applyControlFilters(currentGraph, filters)
  let positioned: PositionedGraph = layoutCommunityGraph(visible, {
    algorithm,
    width,
    height,
    ...options.layoutOptions,
  })
  let adjacency = buildAdjacency(visible)

  const transform = { scale: 1, offsetX: 0, offsetY: 0 }

  // ── DOM scaffold ──────────────────────────────────────────────────────────
  if (getComputedPosition(container) === 'static') container.style.position = 'relative'

  const svg = el('svg', {
    role: 'img',
    'aria-label': 'Community graph',
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
  })
  svg.style.display = 'block'
  svg.style.background = background
  svg.style.touchAction = 'none'
  ;(svg.style as CSSStyleDeclaration).aspectRatio = `${width} / ${height}`

  const viewport = el('g', {}) // pan/zoom transform group
  const edgesLayer = el('g', {})
  const nodesLayer = el('g', {})
  viewport.appendChild(edgesLayer)
  viewport.appendChild(nodesLayer)
  svg.appendChild(viewport)
  container.appendChild(svg)

  const popup = document.createElement('div')
  popup.setAttribute('data-fortemi-graph-popup', '')
  Object.assign(popup.style, {
    position: 'absolute',
    display: 'none',
    pointerEvents: 'none',
    padding: '2px 6px',
    font: '12px system-ui, sans-serif',
    background: '#111',
    color: '#fff',
    borderRadius: '4px',
    transform: 'translate(-50%, -130%)',
    whiteSpace: 'nowrap',
    zIndex: '2',
  } satisfies Partial<CSSStyleDeclaration>)
  container.appendChild(popup)

  // node id → its <circle> element, for restyle on select/hover.
  const circles = new Map<string, SVGCircleElement>()
  const lines: Array<{ line: SVGLineElement; source: string; target: string }> = []

  function applyTransform(): void {
    viewport.setAttribute(
      'transform',
      `translate(${transform.offsetX} ${transform.offsetY}) scale(${transform.scale})`,
    )
  }

  function fitToViewport(): void {
    const bounds = computeGraphBounds(positioned.nodes)
    const fit = fitGraphToViewport(bounds, { width, height }, {
      padding: 24,
      minScale,
      maxScale,
    })
    transform.scale = fit.scale
    transform.offsetX = fit.offsetX
    transform.offsetY = fit.offsetY
    applyTransform()
  }

  function styleNode(id: string): void {
    const circle = circles.get(id)
    if (!circle) return
    const node = positioned.nodeIndex.get(id)
    if (!node) return
    const selected = id === selectedNodeId
    circle.setAttribute('r', String(selected ? node.r + 3 : node.r))
    circle.setAttribute('stroke', selected ? '#111' : '#fff')
    circle.setAttribute('stroke-width', selected ? '3' : '1.5')
  }

  function showPopup(id: string): void {
    const node = positioned.nodeIndex.get(id)
    if (!node) {
      popup.style.display = 'none'
      return
    }
    // node (user units) → screen: apply viewport transform, then SVG scale to px.
    const px = transform.offsetX + node.x * transform.scale
    const py = transform.offsetY + node.y * transform.scale
    const rect = svg.getBoundingClientRect?.()
    const scaleToPx = rect && rect.width ? rect.width / width : 1
    popup.textContent = labelFor(id)
    popup.style.left = `${px * scaleToPx}px`
    popup.style.top = `${py * scaleToPx}px`
    popup.style.display = 'block'
  }

  function setSelected(id: string | null, emit: boolean): void {
    const prev = selectedNodeId
    selectedNodeId = id
    if (prev && prev !== id) styleNode(prev)
    if (id) {
      styleNode(id)
      showPopup(id)
      if (emit) options.onSelectNode?.(id)
    } else {
      popup.style.display = 'none'
    }
  }

  function setHover(id: string | null): void {
    if (!interactive) return
    if (!id) {
      for (const [, c] of circles) c.style.opacity = '1'
      for (const { line } of lines) line.style.opacity = '0.55'
      return
    }
    const keep = new Set<string>(adjacency.get(id) ?? [])
    keep.add(id)
    for (const [nid, c] of circles) c.style.opacity = keep.has(nid) ? '1' : '0.15'
    for (const { line, source, target } of lines) {
      line.style.opacity = source === id || target === id ? '0.9' : '0.06'
    }
  }

  // ── (re)build the DOM for the current positioned graph ─────────────────────
  function build(): void {
    edgesLayer.replaceChildren()
    nodesLayer.replaceChildren()
    circles.clear()
    lines.length = 0

    for (const edge of positioned.edges) {
      const s = positioned.nodeIndex.get(edge.source)
      const t = positioned.nodeIndex.get(edge.target)
      if (!s || !t) continue
      const line = el('line', {
        x1: s.x,
        y1: s.y,
        x2: t.x,
        y2: t.y,
        stroke: '#9aa0a6',
        'stroke-width': clamp(edge.weight, 1, 5),
        opacity: 0.55,
      })
      edgesLayer.appendChild(line)
      lines.push({ line, source: edge.source, target: edge.target })
    }

    for (const node of positioned.nodes) {
      const circle = el('circle', {
        cx: node.x,
        cy: node.y,
        r: node.r,
        fill: colorForCommunity(node.communityId, options.colors),
        stroke: '#fff',
        'stroke-width': 1.5,
        tabindex: 0,
        role: 'button',
        'data-node-id': node.id,
        'aria-label': `Graph node ${labelFor(node.id)}`,
      })
      circle.style.cursor = 'pointer'
      circle.style.outline = 'none'
      const title = el('title', {})
      title.textContent = labelFor(node.id)
      circle.appendChild(title)

      if (interactive) {
        circle.addEventListener('click', (e) => {
          e.stopPropagation()
          setSelected(node.id, true)
        })
        circle.addEventListener('dblclick', (e) => {
          e.stopPropagation()
          options.onNavigate?.(node.id)
        })
        circle.addEventListener('mouseenter', () => setHover(node.id))
        circle.addEventListener('mouseleave', () => setHover(null))
        circle.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (selectedNodeId === node.id) options.onNavigate?.(node.id)
            else setSelected(node.id, true)
          }
        })
      }
      nodesLayer.appendChild(circle)
      circles.set(node.id, circle)
    }

    if (selectedNodeId && circles.has(selectedNodeId)) {
      styleNode(selectedNodeId)
      showPopup(selectedNodeId)
    } else {
      selectedNodeId = null
      popup.style.display = 'none'
    }
  }

  function relayout(): void {
    visible = applyControlFilters(currentGraph, filters)
    positioned = layoutCommunityGraph(visible, {
      algorithm,
      width,
      height,
      ...options.layoutOptions,
    })
    adjacency = buildAdjacency(visible)
    build()
    fitToViewport()
  }

  // ── interactions on the canvas (zoom + pan + deselect) ─────────────────────
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    transform.scale = clamp(transform.scale * factor, minScale, maxScale)
    applyTransform()
    if (selectedNodeId) showPopup(selectedNodeId)
  }
  let panning: { x: number; y: number } | null = null
  const onDown = (e: MouseEvent): void => {
    if (e.target === svg || e.target === viewport) {
      panning = { x: e.clientX, y: e.clientY }
      setSelected(null, true)
    }
  }
  const onMove = (e: MouseEvent): void => {
    if (!panning) return
    transform.offsetX += e.clientX - panning.x
    transform.offsetY += e.clientY - panning.y
    panning = { x: e.clientX, y: e.clientY }
    applyTransform()
  }
  const onUp = (): void => {
    panning = null
  }

  if (interactive) {
    svg.addEventListener('wheel', onWheel, { passive: false })
    svg.addEventListener('mousedown', onDown)
    svg.addEventListener('mousemove', onMove)
    svg.addEventListener('mouseup', onUp)
    svg.addEventListener('mouseleave', onUp)
  }

  // ── initial paint ──────────────────────────────────────────────────────────
  build()
  fitToViewport()

  return {
    element: svg,
    update(next: GraphRenderUpdate): void {
      let needsRelayout = false
      if (next.graph && next.graph !== currentGraph) {
        currentGraph = next.graph
        needsRelayout = true
      }
      if ('filters' in next) {
        filters = next.filters
        needsRelayout = true
      }
      if (next.algorithm && next.algorithm !== algorithm) {
        algorithm = next.algorithm
        needsRelayout = true
      }
      if (next.labelFor) labelFor = next.labelFor
      if (needsRelayout) relayout()
      if ('selectedNodeId' in next) setSelected(next.selectedNodeId ?? null, false)
    },
    focus(nodeId: string | null): void {
      if (!nodeId) {
        setSelected(null, false)
        return
      }
      const node = positioned.nodeIndex.get(nodeId)
      if (!node) return
      // Center the node in the viewport at the current scale.
      transform.offsetX = width / 2 - node.x * transform.scale
      transform.offsetY = height / 2 - node.y * transform.scale
      applyTransform()
      setSelected(nodeId, false)
    },
    destroy(): void {
      if (interactive) {
        svg.removeEventListener('wheel', onWheel)
        svg.removeEventListener('mousedown', onDown)
        svg.removeEventListener('mousemove', onMove)
        svg.removeEventListener('mouseup', onUp)
        svg.removeEventListener('mouseleave', onUp)
      }
      svg.remove()
      popup.remove()
      circles.clear()
      lines.length = 0
    },
  }
}

function getComputedPosition(elm: HTMLElement): string {
  const inline = elm.style.position
  if (inline) return inline
  const view = elm.ownerDocument?.defaultView
  if (view?.getComputedStyle) return view.getComputedStyle(elm).position || 'static'
  return 'static'
}
