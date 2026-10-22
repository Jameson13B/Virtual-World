// One-finger drag to pan, two-finger pinch to zoom, tap to select.
// Uses pointer events, so it works with a mouse too.
class TouchCamera {
  constructor(viewport, { onTap = () => {}, onPan = () => {} } = {}) {
    this.viewport = viewport;
    this.canvas = viewport.canvas;
    this.onTap = onTap;
    this.onPan = onPan;
    this.pointers = new Map();
    this.gesture = null;
    this.canvas.style.touchAction = "none";

    this.canvas.addEventListener("pointerdown", (e) => this.#down(e));
    this.canvas.addEventListener("pointermove", (e) => this.#move(e));
    this.canvas.addEventListener("pointerup", (e) => this.#up(e));
    this.canvas.addEventListener("pointercancel", (e) => this.#up(e, true));
  }

  #local(e) {
    const r = this.canvas.getBoundingClientRect();
    return new Point(e.clientX - r.left, e.clientY - r.top);
  }

  toWorld(screen) {
    const v = this.viewport;
    return new Point((screen.x - v.center.x) * v.zoom - v.offset.x, (screen.y - v.center.y) * v.zoom - v.offset.y);
  }

  #startGesture() {
    const pts = [...this.pointers.values()];
    const v = this.viewport;
    if (pts.length === 1) {
      this.gesture = { type: "pan", start: pts[0], offset: v.offset, moved: this.gesture?.moved || false, t: performance.now() };
    } else if (pts.length >= 2) {
      const mid = average(pts[0], pts[1]);
      this.gesture = {
        type: "pinch",
        dist: Math.max(10, distance(pts[0], pts[1])),
        zoom: v.zoom,
        worldMid: this.toWorld(mid),
        moved: true,
      };
    }
  }

  #down(e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.#local(e));
    if (this.pointers.size === 1) this.gesture = null;
    this.#startGesture();
  }

  #move(e) {
    if (!this.pointers.has(e.pointerId) || !this.gesture) return;
    this.pointers.set(e.pointerId, this.#local(e));
    const v = this.viewport;
    const g = this.gesture;
    const pts = [...this.pointers.values()];
    if (g.type === "pan") {
      const d = subtract(pts[0], g.start);
      if (!g.moved && magnitude(d) > 8) {
        g.moved = true;
        this.onPan();
      }
      if (g.moved) v.offset = add(g.offset, scale(d, v.zoom));
    } else if (g.type === "pinch" && pts.length >= 2) {
      const mid = average(pts[0], pts[1]);
      v.zoom = clamp((g.zoom * g.dist) / Math.max(10, distance(pts[0], pts[1])), v.minZoom, v.maxZoom);
      v.offset = new Point((mid.x - v.center.x) * v.zoom - g.worldMid.x, (mid.y - v.center.y) * v.zoom - g.worldMid.y);
      this.onPan();
    }
  }

  #up(e, cancelled = false) {
    if (!this.pointers.has(e.pointerId)) return;
    const g = this.gesture;
    const pos = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!cancelled && this.pointers.size === 0 && g && g.type === "pan" && !g.moved && performance.now() - g.t < 500) {
      this.onTap(this.toWorld(pos), pos);
    }
    if (this.pointers.size > 0) {
      const moved = true;
      this.#startGesture();
      this.gesture.moved = moved;
    } else {
      this.gesture = null;
    }
  }
}
