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
    return this.viewport.toWorld(screen);
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
        twist: Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x),
        angle: v.angle,
        rotating: false,
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
      if (g.moved) v.offset = add(g.offset, v.toWorldVector(d));
    } else if (g.type === "pinch" && pts.length >= 2) {
      const mid = average(pts[0], pts[1]);
      v.zoom = clamp((g.zoom * g.dist) / Math.max(10, distance(pts[0], pts[1])), v.minZoom, v.maxZoom);
      // Rotation kicks in only after a deliberate twist, so pinching stays steady.
      let twist = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) - g.twist;
      twist = Math.atan2(Math.sin(twist), Math.cos(twist));
      if (!g.rotating && Math.abs(twist) > 0.2) {
        g.rotating = true;
        g.twist += twist;
        twist = 0;
      }
      if (g.rotating) v.angle = g.angle + twist;
      v.offset = subtract(v.toWorldVector(subtract(mid, v.center)), g.worldMid);
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
