// Edits the road graph:
//   left click        add a point (and connect it to the selected one)
//   left click road   split the road, creating a junction
//   drag point        move it
//   right click       deselect / delete point / delete road
//   O                 toggle one-way on the hovered road
//   Delete            remove the selected point
class GraphEditor {
  constructor(viewport, graph) {
    this.viewport = viewport;
    this.canvas = viewport.canvas;
    this.graph = graph;
    this.ctx = this.canvas.getContext("2d");

    this.selected = null;
    this.hovered = null;
    this.hoveredSegment = null;
    this.dragging = false;
    this.moved = false;
    this.mouse = null;
    this.snap = 0;
    this.onChange = () => {};

    this.handlers = {
      mousedown: this.#handleMouseDown.bind(this),
      mousemove: this.#handleMouseMove.bind(this),
      mouseup: this.#handleMouseUp.bind(this),
      keydown: this.#handleKeyDown.bind(this),
    };
  }

  enable() {
    this.canvas.addEventListener("mousedown", this.handlers.mousedown);
    this.canvas.addEventListener("mousemove", this.handlers.mousemove);
    window.addEventListener("mouseup", this.handlers.mouseup);
    window.addEventListener("keydown", this.handlers.keydown);
  }

  disable() {
    this.canvas.removeEventListener("mousedown", this.handlers.mousedown);
    this.canvas.removeEventListener("mousemove", this.handlers.mousemove);
    window.removeEventListener("mouseup", this.handlers.mouseup);
    window.removeEventListener("keydown", this.handlers.keydown);
    this.selected = null;
    this.hovered = null;
    this.hoveredSegment = null;
    this.dragging = false;
  }

  #snapped(p) {
    if (!this.snap) return new Point(p.x, p.y);
    return new Point(Math.round(p.x / this.snap) * this.snap, Math.round(p.y / this.snap) * this.snap);
  }

  #handleMouseMove(evt) {
    this.mouse = this.viewport.getMouse(evt, true);
    const threshold = 12 * this.viewport.zoom;
    this.hovered = getNearestPoint(this.mouse, this.graph.points, threshold);
    this.hoveredSegment = this.hovered
      ? null
      : getNearestSegment(this.mouse, this.graph.segments, threshold * 0.8);
    if (this.dragging && this.selected) {
      const p = this.#snapped(this.mouse);
      this.selected.x = p.x;
      this.selected.y = p.y;
      this.graph.changed();
      this.moved = true;
    }
  }

  #handleMouseDown(evt) {
    if (this.viewport.isPanGesture(evt)) return;
    this.mouse = this.viewport.getMouse(evt, true);

    if (evt.button == 2) {
      if (this.selected) {
        this.selected = null;
      } else if (this.hovered) {
        this.#removePoint(this.hovered);
      } else if (this.hoveredSegment) {
        this.graph.removeSegment(this.hoveredSegment);
        this.hoveredSegment = null;
        this.onChange();
      }
    }

    if (evt.button == 0) {
      if (this.hovered) {
        this.#select(this.hovered);
        this.dragging = true;
        this.onChange();
        return;
      }
      let p;
      if (this.hoveredSegment) {
        p = this.hoveredSegment.projectPoint(this.mouse).point;
        this.graph.splitSegment(this.hoveredSegment, p);
        this.hoveredSegment = null;
      } else {
        p = this.#snapped(this.mouse);
        const existing = this.graph.containsPoint(p);
        if (existing) p = existing;
        else this.graph.addPoint(p);
      }
      this.#select(p);
      this.hovered = p;
      this.onChange();
    }
  }

  #handleMouseUp() {
    if (this.dragging && this.moved) {
      this.graph.changed(); // triggers a full (non-quick) regeneration
      this.onChange();
    }
    this.dragging = false;
    this.moved = false;
  }

  #handleKeyDown(evt) {
    if (isTyping(evt) || evt.metaKey || evt.ctrlKey) return;
    switch (evt.key) {
      case "Escape":
        this.selected = null;
        break;
      case "Delete":
      case "Backspace": {
        const p = this.selected || this.hovered;
        if (p) this.#removePoint(p);
        else if (this.hoveredSegment) {
          this.graph.removeSegment(this.hoveredSegment);
          this.hoveredSegment = null;
          this.onChange();
        }
        evt.preventDefault();
        break;
      }
      case "o":
      case "O":
        if (this.hoveredSegment) {
          const seg = this.hoveredSegment;
          // cycle: two-way -> one-way (p1->p2) -> one-way (p2->p1) -> two-way
          if (!seg.oneWay) seg.oneWay = true;
          else if (!seg.reversedOnce) {
            [seg.p1, seg.p2] = [seg.p2, seg.p1];
            seg.reversedOnce = true;
          } else {
            seg.oneWay = false;
            seg.reversedOnce = false;
          }
          this.graph.changed();
          this.onChange();
        }
        break;
    }
  }

  #select(point) {
    if (this.selected && this.selected !== point) {
      this.graph.tryAddSegment(new Segment(this.selected, point));
    }
    this.selected = point;
  }

  #removePoint(point) {
    this.graph.removePoint(point);
    this.hovered = null;
    if (this.selected == point) this.selected = null;
    this.onChange();
  }

  dispose() {
    this.graph.dispose();
    this.selected = null;
    this.hovered = null;
  }

  display() {
    const s = Math.max(1, this.viewport.zoom);
    this.graph.draw(this.ctx, { scale: s, showOneWay: true });
    if (this.hoveredSegment) {
      this.hoveredSegment.draw(this.ctx, { width: 8 * s, color: "rgba(255,230,0,0.6)", cap: "round" });
    }
    if (this.hovered) {
      this.hovered.draw(this.ctx, { fill: true, size: 18 * s });
    }
    if (this.selected) {
      const intent = this.hovered ? this.hovered : this.mouse ? this.#snapped(this.mouse) : null;
      if (intent) new Segment(this.selected, intent).draw(this.ctx, { dash: [3 * s, 3 * s], width: 2 * s });
      this.selected.draw(this.ctx, { outline: true, size: 18 * s });
    }
  }
}
