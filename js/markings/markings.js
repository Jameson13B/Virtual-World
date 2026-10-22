// ---------------------------------------------------------------------------
// Road markings. Every marking is a small rectangle (poly) centred on a lane,
// oriented along `directionVector` (the direction traffic travels).
//
// To add a new marking:
//   1. write a class that extends Marking and overrides draw()
//   2. register it in MarkingTypes at the bottom of this file
// A toolbar button and editor are created for it automatically.
// ---------------------------------------------------------------------------

class Marking {
  constructor(center, directionVector, width, height) {
    this.center = center;
    this.directionVector = directionVector;
    this.width = width;
    this.height = height;
    this.type = "marking";

    // support.p1 is the "front" of the marking (where traffic is heading).
    this.support = new Segment(
      translate(center, angle(directionVector), height / 2),
      translate(center, angle(directionVector), -height / 2)
    );
    this.poly = new Envelope(this.support, width, 0).poly;
    // poly.segments[0] = front edge, [1] = right side, [2] = back edge, [3] = left side
  }

  static load(info) {
    const spec = MarkingTypes[info.type];
    if (!spec) return null;
    const center = new Point(info.center.x, info.center.y);
    const dir = new Point(info.directionVector.x, info.directionVector.y);
    return new spec.cls(center, dir, info.width, info.height);
  }

  toJSON() {
    return {
      type: this.type,
      center: { x: this.center.x, y: this.center.y },
      directionVector: { x: this.directionVector.x, y: this.directionVector.y },
      width: this.width,
      height: this.height,
    };
  }

  // Rotation that makes canvas "up" point along the travel direction,
  // so text is readable to approaching drivers.
  textAngle() {
    return Math.atan2(this.directionVector.x, -this.directionVector.y);
  }

  drawText(ctx, text, { size = 0.3, stretch = 2.2, color = "white" } = {}) {
    ctx.save();
    ctx.translate(this.center.x, this.center.y);
    ctx.rotate(this.textAngle());
    ctx.scale(1, stretch);
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillStyle = color;
    ctx.font = "bold " + this.height * size + "px Arial";
    ctx.fillText(text, 0, 1);
    ctx.restore();
  }

  draw(ctx) {
    this.poly.draw(ctx);
  }
}

class Stop extends Marking {
  constructor(center, directionVector, width, height) {
    super(center, directionVector, width, height);
    this.type = "stop";
    this.border = this.poly.segments[0];
  }

  draw(ctx) {
    this.border.draw(ctx, { width: 5, color: "white" });
    this.drawText(ctx, "STOP", { size: 0.32 });
  }
}

class Yield extends Marking {
  constructor(center, directionVector, width, height) {
    super(center, directionVector, width, height);
    this.type = "yield";
    this.border = this.poly.segments[0];
  }

  draw(ctx) {
    // "Shark teeth" pointing toward the driver.
    const { p1, p2 } = this.border;
    const teeth = 5;
    const back = scale(this.directionVector, -this.height * 0.22);
    ctx.fillStyle = "white";
    for (let i = 0; i < teeth; i++) {
      const a = lerp2D(p1, p2, (i + 0.15) / teeth);
      const b = lerp2D(p1, p2, (i + 0.85) / teeth);
      const tip = add(average(a, b), back);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.closePath();
      ctx.fill();
    }
    this.drawText(ctx, "YIELD", { size: 0.24 });
  }
}

class Crossing extends Marking {
  constructor(center, directionVector, width, height) {
    super(center, directionVector, width, height);
    this.type = "crossing";
    this.borders = [this.poly.segments[0], this.poly.segments[2]];
  }

  draw(ctx) {
    const perp = perpendicular(this.directionVector);
    const line = new Segment(
      add(this.center, scale(perp, this.width / 2)),
      add(this.center, scale(perp, -this.width / 2))
    );
    line.draw(ctx, { width: this.height, color: "white", dash: [11, 11] });
  }
}

class Light extends Marking {
  constructor(center, directionVector, width, height) {
    super(center, directionVector, width, height);
    this.type = "light";
    this.state = "off";
    this.border = this.poly.segments[0];
  }

  bulbs() {
    const perp = perpendicular(this.directionVector);
    const line = new Segment(
      add(this.center, scale(perp, this.width / 2)),
      add(this.center, scale(perp, -this.width / 2))
    );
    return {
      line,
      green: lerp2D(line.p1, line.p2, 0.2),
      yellow: lerp2D(line.p1, line.p2, 0.5),
      red: lerp2D(line.p1, line.p2, 0.8),
    };
  }

  activeBulb() {
    const b = this.bulbs();
    return { green: b.green, yellow: b.yellow, red: b.red }[this.state] || null;
  }

  draw(ctx) {
    const { green, yellow, red } = this.bulbs();
    new Segment(red, green).draw(ctx, { width: this.height, cap: "round" });
    const size = this.height * 0.6;
    green.draw(ctx, { size, color: "#060" });
    yellow.draw(ctx, { size, color: "#660" });
    red.draw(ctx, { size, color: "#600" });

    switch (this.state) {
      case "green":
        green.draw(ctx, { size, color: "#0F0" });
        break;
      case "yellow":
        yellow.draw(ctx, { size, color: "#FF0" });
        break;
      case "red":
        red.draw(ctx, { size, color: "#F00" });
        break;
    }
    if (this.state === "red" || this.state === "yellow") {
      this.border.draw(ctx, { width: 3, color: "white" });
    }
  }
}

class Parking extends Marking {
  constructor(center, directionVector, width, height) {
    super(center, directionVector, width, height);
    this.type = "parking";
    this.borders = [this.poly.segments[1], this.poly.segments[3]];
  }

  draw(ctx) {
    for (const border of this.borders) {
      border.draw(ctx, { width: 5, color: "white" });
    }
    this.drawText(ctx, "P", { size: 0.5, stretch: 1.4 });
  }
}

class Start extends Marking {
  constructor(center, directionVector, width, height) {
    super(center, directionVector, width, height);
    this.type = "start";
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.center.x, this.center.y);
    ctx.rotate(this.textAngle());
    const w = this.width * 0.6, h = this.height * 0.95;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "white";
    roundRectPath(ctx, -w / 2, -h / 2, w, h, 7);
    ctx.stroke();
    ctx.setLineDash([]);
    // arrow
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.moveTo(0, -h / 2 - 14);
    ctx.lineTo(9, -h / 2 - 3);
    ctx.lineTo(-9, -h / 2 - 3);
    ctx.closePath();
    ctx.fill();
    ctx.font = "bold 11px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("START", 0, 0);
    ctx.restore();
  }
}

class Target extends Marking {
  constructor(center, directionVector, width, height) {
    super(center, directionVector, width, height);
    this.type = "target";
  }

  draw(ctx) {
    this.center.draw(ctx, { color: "red", size: this.width * 0.9 });
    this.center.draw(ctx, { color: "white", size: this.width * 0.6 });
    this.center.draw(ctx, { color: "red", size: this.width * 0.3 });
  }
}

// targets: "lanes" snaps to lane centres, "roads" snaps to road centre lines.
// size(roadWidth) -> [width, height]. unique: only one allowed per world.
const MarkingTypes = {
  stop: { cls: Stop, label: "Stop", icon: "🛑", targets: "lanes", size: (rw) => [rw / 2, rw / 2] },
  yield: { cls: Yield, label: "Yield", icon: "⚠️", targets: "lanes", size: (rw) => [rw / 2, rw / 2] },
  crossing: { cls: Crossing, label: "Crossing", icon: "🚶", targets: "roads", size: (rw) => [rw, rw / 2] },
  light: { cls: Light, label: "Light", icon: "🚦", targets: "lanes", size: (rw) => [rw / 2, rw * 0.18] },
  parking: { cls: Parking, label: "Parking", icon: "🅿️", targets: "lanes", size: (rw) => [rw / 2, rw * 0.6] },
  start: { cls: Start, label: "Start", icon: "🚗", targets: "lanes", size: (rw) => [rw / 2, rw / 2], unique: true },
  target: { cls: Target, label: "Target", icon: "🎯", targets: "lanes", size: (rw) => [rw / 2, rw / 2], unique: true },
};
