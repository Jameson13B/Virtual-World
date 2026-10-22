// Overview of the whole world. Click or drag on it to move the camera.
class MiniMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.transform = null;
    this.onJump = () => {};
    let dragging = false;
    canvas.addEventListener("mousedown", (e) => {
      dragging = true;
      this.#jump(e);
    });
    canvas.addEventListener("mousemove", (e) => dragging && this.#jump(e));
    window.addEventListener("mouseup", () => (dragging = false));
  }

  #jump(evt) {
    if (!this.transform) return;
    const { s, cx, cy, w, h } = this.transform;
    this.onJump(new Point((evt.offsetX - w / 2) / s + cx, (evt.offsetY - h / 2) / s + cy));
  }

  draw(world, viewport, cars = [], player = null) {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const b = world.bounds;
    const s = Math.min(w / (b.maxX - b.minX), h / (b.maxY - b.minY)) * 0.92;
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    this.transform = { s, cx, cy, w, h };

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(s, s);
    ctx.translate(-cx, -cy);

    ctx.beginPath();
    for (const seg of world.graph.segments) {
      ctx.moveTo(seg.p1.x, seg.p1.y);
      ctx.lineTo(seg.p2.x, seg.p2.y);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = Math.max(1.5 / s, world.roadWidth * 0.6);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    const dot = (p, color, r) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r / s, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    };
    for (const m of world.markings) {
      if (m.type === "start") dot(m.center, "#22c55e", 4);
      else if (m.type === "target") dot(m.center, "#ef4444", 4);
      else if (m.type === "light") dot(m.center, m.state === "green" ? "#0f0" : m.state === "yellow" ? "#ff0" : "#f00", 1.6);
    }
    for (const c of cars) dot(c, c.color, 2);
    if (player) dot(player, "#2563eb", 4.5);

    const v = viewport.getVisibleBounds();
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 1.5 / s;
    ctx.strokeRect(v.minX, v.minY, v.maxX - v.minX, v.maxY - v.minY);
    ctx.restore();
  }
}
