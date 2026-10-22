class Sensor {
  constructor(car, { rayCount = 5, rayLength = 150, raySpread = Math.PI / 2 } = {}) {
    this.car = car;
    this.rayCount = rayCount;
    this.rayLength = rayLength;
    this.raySpread = raySpread;
    this.rays = [];
    this.readings = [];
  }

  update(roadBorders, traffic) {
    this.#castRays();
    this.readings = this.rays.map((ray) => this.#getReading(ray, roadBorders, traffic));
  }

  #getReading(ray, roadBorders, traffic) {
    let nearest = null;
    const consider = (touch) => {
      if (touch && (!nearest || touch.offset < nearest.offset)) nearest = touch;
    };
    for (const seg of roadBorders) {
      consider(getIntersection(ray[0], ray[1], seg.p1, seg.p2));
    }
    for (const car of traffic) {
      if (distance(car, this.car) > this.rayLength + 60) continue;
      const poly = car.polygon;
      for (let j = 0; j < poly.length; j++) {
        consider(getIntersection(ray[0], ray[1], poly[j], poly[(j + 1) % poly.length]));
      }
    }
    return nearest;
  }

  #castRays() {
    this.rays = [];
    for (let i = 0; i < this.rayCount; i++) {
      const rayAngle =
        lerp(this.raySpread / 2, -this.raySpread / 2, this.rayCount == 1 ? 0.5 : i / (this.rayCount - 1)) +
        this.car.angle;
      const start = { x: this.car.x, y: this.car.y };
      const end = {
        x: this.car.x - Math.sin(rayAngle) * this.rayLength,
        y: this.car.y - Math.cos(rayAngle) * this.rayLength,
      };
      this.rays.push([start, end]);
    }
  }

  draw(ctx) {
    for (let i = 0; i < this.rays.length; i++) {
      const end = this.readings[i] || this.rays[i][1];
      ctx.beginPath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "yellow";
      ctx.moveTo(this.rays[i][0].x, this.rays[i][0].y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = "black";
      ctx.moveTo(this.rays[i][1].x, this.rays[i][1].y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
  }
}
