// controlType: "KEYS" (you drive), "AI" (neural network), "DUMMY" (always forward),
// "AUTO" (scripted traffic – see TrafficCar).
class Car {
  constructor(x, y, width, height, controlType, angle = 0, maxSpeed = 3, color = "blue") {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.angle = angle;
    this.color = color;

    this.speed = 0;
    this.acceleration = 0.2;
    this.maxSpeed = maxSpeed;
    this.friction = 0.05;
    this.damaged = false;
    this.braking = false;
    this.fitness = 0;

    this.useBrain = controlType == "AI";
    if (controlType == "AI" || controlType == "KEYS") {
      this.sensor = new Sensor(this);
      this.brain = new NeuralNetwork([this.sensor.rayCount, 6, 4]);
    }
    this.controls = new Controls(controlType);
    this.polygon = this.createPolygon();
  }

  update(roadBorders, traffic, { collide = true } = {}) {
    // Only look at borders near the car – huge speedup on big maps.
    const reach = (this.sensor ? this.sensor.rayLength : 0) + this.height;
    const nearBorders = roadBorders.filter((s) => segmentNear(s, this, reach));

    if (!this.damaged) {
      this.#move();
      this.fitness += this.speed;
      this.polygon = this.createPolygon();
      if (collide) this.damaged = this.#assessDamage(nearBorders, traffic);
    }
    if (this.sensor) {
      this.sensor.update(nearBorders, traffic);
      const offsets = this.sensor.readings.map((s) => (s == null ? 0 : 1 - s.offset));
      const outputs = NeuralNetwork.feedForward(offsets, this.brain);
      if (this.useBrain) {
        this.controls.forward = outputs[0];
        this.controls.left = outputs[1];
        this.controls.right = outputs[2];
        this.controls.reverse = outputs[3];
      }
    }
  }

  #assessDamage(roadBorders, traffic) {
    for (const seg of roadBorders) {
      if (polysIntersect(this.polygon, [seg.p1, seg.p2])) return true;
    }
    for (const car of traffic) {
      if (car === this || distance(car, this) > this.height * 2) continue;
      if (polysIntersect(this.polygon, car.polygon)) return true;
    }
    return false;
  }

  createPolygon() {
    const points = [];
    const rad = Math.hypot(this.width, this.height) / 2;
    const alpha = Math.atan2(this.width, this.height);
    points.push({ x: this.x - Math.sin(this.angle - alpha) * rad, y: this.y - Math.cos(this.angle - alpha) * rad });
    points.push({ x: this.x - Math.sin(this.angle + alpha) * rad, y: this.y - Math.cos(this.angle + alpha) * rad });
    points.push({ x: this.x - Math.sin(Math.PI + this.angle - alpha) * rad, y: this.y - Math.cos(Math.PI + this.angle - alpha) * rad });
    points.push({ x: this.x - Math.sin(Math.PI + this.angle + alpha) * rad, y: this.y - Math.cos(Math.PI + this.angle + alpha) * rad });
    return points;
  }

  #move() {
    const c = this.controls;
    const maxSpeed = this.maxSpeed * (c.boost ? 1.6 : 1);
    if (c.forward) this.speed += this.acceleration;
    if (c.reverse) this.speed -= this.acceleration;
    this.braking = c.reverse && this.speed > 0;

    if (this.speed > maxSpeed) this.speed = Math.max(maxSpeed, this.speed - this.acceleration);
    if (this.speed < -this.maxSpeed / 2) this.speed = -this.maxSpeed / 2;

    if (this.speed > 0) this.speed -= this.friction;
    if (this.speed < 0) this.speed += this.friction;
    if (Math.abs(this.speed) < this.friction) this.speed = 0;

    if (this.speed != 0) {
      const flip = this.speed > 0 ? 1 : -1;
      if (c.left) this.angle += 0.03 * flip;
      if (c.right) this.angle -= 0.03 * flip;
    }

    this.x -= Math.sin(this.angle) * this.speed;
    this.y -= Math.cos(this.angle) * this.speed;
  }

  dispose() {
    this.controls.dispose();
  }

  draw(ctx, { sensor = false } = {}) {
    if (this.sensor && sensor) this.sensor.draw(ctx);

    const w = this.width, h = this.height;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(-this.angle);

    ctx.fillStyle = "rgba(0,0,0,0.3)";
    roundRectPath(ctx, -w / 2 + 3, -h / 2 + 4, w, h, 7);
    ctx.fill();

    ctx.fillStyle = this.damaged ? "#777" : this.color;
    roundRectPath(ctx, -w / 2, -h / 2, w, h, 7);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.stroke();

    ctx.fillStyle = "rgba(20,30,50,0.85)";
    roundRectPath(ctx, -w / 2 + 4, -h / 2 + h * 0.2, w - 8, h * 0.2, 3); // windshield
    ctx.fill();
    roundRectPath(ctx, -w / 2 + 5, h / 2 - h * 0.25, w - 10, h * 0.12, 3); // rear window
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    roundRectPath(ctx, -w / 2 + 5, -h / 2 + h * 0.43, w - 10, h * 0.28, 3); // roof
    ctx.fill();

    ctx.fillStyle = "#fff6b0";
    ctx.fillRect(-w / 2 + 3, -h / 2, 6, 3);
    ctx.fillRect(w / 2 - 9, -h / 2, 6, 3);
    ctx.fillStyle = this.braking ? "#ff2a2a" : "#8a1010";
    ctx.fillRect(-w / 2 + 3, h / 2 - 3, 6, 3);
    ctx.fillRect(w / 2 - 9, h / 2 - 3, 6, 3);

    if (this.damaged) {
      ctx.font = "20px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("💥", 0, 0);
    }
    ctx.restore();
  }
}
