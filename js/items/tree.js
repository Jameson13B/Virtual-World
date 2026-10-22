class Tree {
  constructor(center, size, { height = 200, tint = 0 } = {}) {
    this.center = center;
    this.size = size; // size of the base
    this.height = height;
    this.tint = tint; // -1..1, small color variation between trees
    this.base = this.#generateLevel(center, size);
    this.bounds = {
      minX: center.x - size - height, minY: center.y - size - height,
      maxX: center.x + size + height, maxY: center.y + size + height,
    };
  }

  #levelPoints(point, size) {
    const points = [];
    const rad = size / 2;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
      // deterministic "noise" so trees don't wobble between frames
      const kindOfRandom = Math.cos(((a + this.center.x) * size) % 17) ** 2;
      const noisyRadius = rad * lerp(0.5, 1, kindOfRandom);
      points.push(translate(point, a, noisyRadius));
    }
    return points;
  }

  #generateLevel(point, size) {
    return new Polygon(this.#levelPoints(point, size));
  }

  draw(ctx, viewPoint) {
    const top = getFake3dPoint(this.center, viewPoint, this.height);
    const levelCount = 7;
    for (let level = 0; level < levelCount; level++) {
      const t = level / (levelCount - 1);
      const point = lerp2D(this.center, top, t);
      const g = lerp(50, 200, t) + this.tint * 25;
      ctx.fillStyle = "rgb(" + (30 + this.tint * 20) + "," + g + ",70)";
      const pts = this.#levelPoints(point, lerp(this.size, 40, t));
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fill();
    }
  }
}
