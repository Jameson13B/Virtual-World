// Generic editor that places one kind of marking on lanes or roads.
//   hover a lane   preview the marking
//   left click     place it
//   Shift          flip its direction
//   right click    remove the marking under the cursor
class MarkingEditor {
  constructor(viewport, world, getTargetSegments, createMarking, { type, unique = false, orient = true } = {}) {
    this.viewport = viewport;
    this.world = world;
    this.canvas = viewport.canvas;
    this.ctx = this.canvas.getContext("2d");
    this.getTargetSegments = getTargetSegments;
    this.createMarking = createMarking;
    this.type = type;
    this.unique = unique;
    this.orient = orient;

    this.mouse = null;
    this.intent = null;
    this.hoveredMarking = null;
    this.flip = false;
    this.onChange = () => {};

    this.handlers = {
      mousedown: this.#handleMouseDown.bind(this),
      mousemove: this.#handleMouseMove.bind(this),
      keydown: (e) => this.#handleShift(e),
      keyup: (e) => this.#handleShift(e),
    };
  }

  enable() {
    this.canvas.addEventListener("mousedown", this.handlers.mousedown);
    this.canvas.addEventListener("mousemove", this.handlers.mousemove);
    window.addEventListener("keydown", this.handlers.keydown);
    window.addEventListener("keyup", this.handlers.keyup);
  }

  disable() {
    this.canvas.removeEventListener("mousedown", this.handlers.mousedown);
    this.canvas.removeEventListener("mousemove", this.handlers.mousemove);
    window.removeEventListener("keydown", this.handlers.keydown);
    window.removeEventListener("keyup", this.handlers.keyup);
    this.intent = null;
    this.hoveredMarking = null;
  }

  #handleShift(evt) {
    if (evt.key !== "Shift") return;
    this.flip = evt.type === "keydown";
    this.#updateIntent();
  }

  // Lane guides run in arbitrary directions; point the marking the way
  // traffic in that lane drives (right-hand traffic).
  #travelDirection(point, dir) {
    if (!this.orient) return dir;
    const seg = getNearestSegment(point, this.world.graph.segments);
    if (!seg) return dir;
    const sDir = seg.directionVector();
    const side = dot(subtract(point, seg.p1), perpendicular(sDir));
    const travel = side >= 0 ? sDir : scale(sDir, -1);
    return dot(dir, travel) >= 0 ? dir : scale(dir, -1);
  }

  #updateIntent() {
    if (!this.mouse) return;
    this.hoveredMarking = [...this.world.markings].reverse().find((m) => m.poly.containsPoint(this.mouse)) || null;
    const seg = getNearestSegment(this.mouse, this.getTargetSegments(), 12 * this.viewport.zoom);
    this.intent = null;
    if (seg) {
      const proj = seg.projectPoint(this.mouse);
      if (proj.offset >= 0 && proj.offset <= 1) {
        let dir = this.#travelDirection(proj.point, seg.directionVector());
        if (this.flip) dir = scale(dir, -1);
        this.intent = this.createMarking(proj.point, dir);
      }
    }
  }

  #handleMouseMove(evt) {
    this.mouse = this.viewport.getMouse(evt, true);
    this.flip = evt.shiftKey;
    this.#updateIntent();
  }

  #handleMouseDown(evt) {
    if (this.viewport.isPanGesture(evt)) return;
    if (evt.button == 0) {
      if (this.intent) {
        if (this.unique) {
          this.world.markings = this.world.markings.filter((m) => m.type !== this.type);
        }
        this.world.markings.push(this.intent);
        this.intent = null;
        this.onChange();
      }
    }
    if (evt.button == 2) {
      for (let i = this.world.markings.length - 1; i >= 0; i--) {
        if (this.world.markings[i].poly.containsPoint(this.mouse)) {
          this.world.markings.splice(i, 1);
          this.hoveredMarking = null;
          this.onChange();
          return;
        }
      }
    }
  }

  display() {
    if (this.hoveredMarking) {
      this.hoveredMarking.poly.draw(this.ctx, {
        fill: "rgba(255,0,0,0.15)", stroke: "rgba(255,60,60,0.9)", lineWidth: 2,
      });
    }
    if (this.intent) {
      this.ctx.globalAlpha = 0.85;
      this.intent.draw(this.ctx);
      this.ctx.globalAlpha = 1;
      // little arrow showing travel direction
      const c = this.intent.center;
      const tip = add(c, scale(this.intent.directionVector, this.intent.height * 0.9));
      new Segment(c, tip).draw(this.ctx, { width: 3, color: "#facc15" });
      tip.draw(this.ctx, { size: 8, color: "#facc15" });
    }
  }
}
