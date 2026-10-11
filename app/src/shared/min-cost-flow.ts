/**
 * A small min-cost max-flow solver (successive shortest paths, Bellman-Ford queue). The seating
 * engine uses it to decide how many students of each category go to each hall: the most students
 * that can be seated, and among those plans the one that best follows the configured hall and
 * category order. Deterministic: edges are tried in the order they were added.
 */
export class MinCostFlow {
  private to: number[] = []
  private cap: number[] = []
  private cost: number[] = []
  private adj: number[][]

  constructor(nodes: number) { this.adj = Array.from({ length: nodes }, () => []) }

  /** Adds an edge and returns its id (for flowOn). */
  addEdge(from: number, to: number, capacity: number, cost: number): number {
    const id = this.to.length
    this.to.push(to, from); this.cap.push(capacity, 0); this.cost.push(cost, -cost)
    this.adj[from].push(id); this.adj[to].push(id + 1)
    return id
  }

  /** Flow sent along an edge (its reverse edge's residual capacity). */
  flowOn(edge: number): number { return this.cap[edge + 1] }

  /** Sends as much flow as possible from source to sink at the least total cost. */
  run(source: number, sink: number): { flow: number; cost: number } {
    const n = this.adj.length
    let flow = 0, total = 0
    for (;;) {
      const dist = new Array<number>(n).fill(Infinity), via = new Array<number>(n).fill(-1), queued = new Array<boolean>(n).fill(false)
      dist[source] = 0
      const queue = [source]
      queued[source] = true
      for (let head = 0; head < queue.length; head++) {
        const u = queue[head]
        queued[u] = false
        for (const e of this.adj[u]) {
          if (this.cap[e] <= 0) continue
          const v = this.to[e], d = dist[u] + this.cost[e]
          if (d < dist[v]) {
            dist[v] = d; via[v] = e
            if (!queued[v]) { queued[v] = true; queue.push(v) }
          }
        }
      }
      if (dist[sink] === Infinity) return { flow, cost: total }
      let push = Infinity
      for (let v = sink; v !== source; v = this.to[via[v] ^ 1]) push = Math.min(push, this.cap[via[v]])
      for (let v = sink; v !== source; v = this.to[via[v] ^ 1]) { this.cap[via[v]] -= push; this.cap[via[v] ^ 1] += push }
      flow += push; total += push * dist[sink]
    }
  }
}
