// Pan & zoom. `zoom` is "world units per screen pixel" (bigger = further out).
//   wheel / pinch          zoom around the cursor
//   middle-drag            pan
//   Space + left-drag      pan (trackpad friendly)
class Viewport {
  constructor(canvas, zoom = 1, offset = null) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.zoom = zoom;
    this.angle = 0; // map rotation in radians (the town game's two-finger twist)
    this.minZoom = 0.15;
    this.maxZoom = 120;
    this.center = new Point(0, 0);
    this.resize();
    this.offset = offset ? offset : new Point(0, 0);
    this.drag = {
      start: new Point(0, 0),
      end: new Point(0, 0),
      offset: new Point(0, 0),
      active: false,
    };
    this.spaceDown = false;
    this.onUserPan = () => {};
    this.#addEventListeners();
  }

  // Re-measures when the canvas's on-screen size changed. In-app browsers can
  // resize the page (toolbars sliding away) without firing a resize event.
  fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.clientWidth !== this.width || this.canvas.clientHeight !== this.height || dpr !== this.dpr) this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1); // cap for phone performance
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.dpr = dpr;
    this.width = w;
    this.height = h;
    this.center = new Point(w / 2, h / 2);
  }

  reset(background = "#2a5") {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.translate(this.center.x, this.center.y);
    ctx.rotate(this.angle);
    ctx.viewAngle = this.angle; // lets text be drawn upright on a rotated map
    ctx.scale(1 / this.zoom, 1 / this.zoom);
    const offset = this.getOffset();
    ctx.translate(offset.x, offset.y);
  }

  getMouse(evt, subtractDragOffset = false) {
    const p = this.toWorld(new Point(evt.offsetX, evt.offsetY));
    return subtractDragOffset ? subtract(p, this.drag.offset) : p;
  }

  // Screen pixels → world point, and a screen-space vector → world vector.
  toWorld(screen) {
    return subtract(this.toWorldVector(subtract(screen, this.center)), this.offset);
  }

  toWorldVector(v) {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    return new Point((v.x * c + v.y * s) * this.zoom, (-v.x * s + v.y * c) * this.zoom);
  }

  getOffset() {
    return add(this.offset, this.drag.offset);
  }

  // World point at the centre of the screen.
  getViewPoint() {
    return scale(this.getOffset(), -1);
  }

  getVisibleBounds() {
    const off = this.getOffset();
    // Bounding box of the (possibly rotated) screen rectangle.
    const c = Math.abs(Math.cos(this.angle)), s = Math.abs(Math.sin(this.angle));
    const hw = this.center.x * this.zoom, hh = this.center.y * this.zoom;
    const w = hw * c + hh * s, h = hw * s + hh * c;
    return { minX: -w - off.x, minY: -h - off.y, maxX: w - off.x, maxY: h - off.y };
  }

  lookAt(point) {
    this.offset = scale(point, -1);
  }

  fitBounds(b, padding = 1.15) {
    const w = Math.max(200, b.maxX - b.minX);
    const h = Math.max(200, b.maxY - b.minY);
    this.zoom = clamp(Math.max(w / this.width, h / this.height) * padding, this.minZoom, this.maxZoom);
    this.offset = new Point(-(b.minX + b.maxX) / 2, -(b.minY + b.maxY) / 2);
  }

  isPanGesture(evt) {
    return evt.button == 1 || (evt.button == 0 && this.spaceDown) || this.drag.active;
  }

  #addEventListeners() {
    this.canvas.addEventListener("wheel", this.#handleWheel.bind(this), { passive: false });
    this.canvas.addEventListener("mousedown", this.#handleMouseDown.bind(this));
    this.canvas.addEventListener("mousemove", this.#handleMouseMove.bind(this));
    window.addEventListener("mouseup", this.#handleMouseUp.bind(this));
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !isTyping(e)) {
        this.spaceDown = true;
        this.canvas.style.cursor = "grab";
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        this.spaceDown = false;
        this.canvas.style.cursor = "";
      }
    });
  }

  #handleWheel(evt) {
    evt.preventDefault();
    const before = this.getMouse(evt);
    const delta = clamp(evt.deltaY, -120, 120) * (evt.ctrlKey ? 4 : 1);
    this.zoom = clamp(this.zoom * Math.exp(delta * 0.0015), this.minZoom, this.maxZoom);
    const after = this.getMouse(evt);
    this.offset = add(this.offset, subtract(after, before));
  }

  #handleMouseDown(evt) {
    if (evt.button == 1 || (evt.button == 0 && this.spaceDown)) {
      evt.preventDefault();
      this.drag.start = this.getMouse(evt);
      this.drag.active = true;
      this.canvas.style.cursor = "grabbing";
      this.onUserPan();
    }
  }

  #handleMouseMove(evt) {
    if (this.drag.active) {
      this.drag.end = this.getMouse(evt);
      this.drag.offset = subtract(this.drag.end, this.drag.start);
    }
  }

  #handleMouseUp() {
    if (this.drag.active) {
      this.offset = add(this.offset, this.drag.offset);
      this.drag = {
        start: new Point(0, 0),
        end: new Point(0, 0),
        offset: new Point(0, 0),
        active: false,
      };
      this.canvas.style.cursor = this.spaceDown ? "grab" : "";
    }
  }
}
