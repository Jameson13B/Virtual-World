class Polygon {
  constructor(points) {
    this.points = points;
    this.segments = [];
    for (let i = 1; i <= points.length; i++) {
      this.segments.push(new Segment(points[i - 1], points[i % points.length]));
    }
    // Bounding box speeds up the expensive geometry checks a lot.
    this.bounds = boundsOf(points);
  }

  static load(info) {
    return new Polygon(info.points.map((p) => new Point(p.x, p.y)));
  }

  // Returns the outline segments of the union of all polygons.
  static union(polys) {
    Polygon.multiBreak(polys);
    const keptSegments = [];
    for (let i = 0; i < polys.length; i++) {
      for (const seg of polys[i].segments) {
        let keep = true;
        for (let j = 0; j < polys.length; j++) {
          if (i != j && polys[j].containsSegment(seg)) {
            keep = false;
            break;
          }
        }
        if (keep) keptSegments.push(seg);
      }
    }
    return keptSegments;
  }

  static multiBreak(polys) {
    for (let i = 0; i < polys.length - 1; i++) {
      for (let j = i + 1; j < polys.length; j++) {
        if (boundsOverlap(polys[i].bounds, polys[j].bounds)) {
          Polygon.break(polys[i], polys[j]);
        }
      }
    }
  }

  // Splits segments of both polygons at every place where they cross.
  static break(poly1, poly2) {
    const segs1 = poly1.segments;
    const segs2 = poly2.segments;
    for (let i = 0; i < segs1.length; i++) {
      for (let j = 0; j < segs2.length; j++) {
        const int = getIntersection(segs1[i].p1, segs1[i].p2, segs2[j].p1, segs2[j].p2);
        if (int && int.offset != 1 && int.offset != 0) {
          const point = new Point(int.x, int.y);
          let aux = segs1[i].p2;
          segs1[i].p2 = point;
          segs1.splice(i + 1, 0, new Segment(point, aux));
          aux = segs2[j].p2;
          segs2[j].p2 = point;
          segs2.splice(j + 1, 0, new Segment(point, aux));
        }
      }
    }
  }

  boundsDistance(point) {
    const b = this.bounds;
    const dx = Math.max(b.minX - point.x, 0, point.x - b.maxX);
    const dy = Math.max(b.minY - point.y, 0, point.y - b.maxY);
    return Math.hypot(dx, dy);
  }

  distanceToPoint(point) {
    let min = Infinity;
    for (const s of this.segments) min = Math.min(min, s.distanceToPoint(point));
    return min;
  }

  distanceToPoly(poly) {
    let min = Infinity;
    for (const p of this.points) min = Math.min(min, poly.distanceToPoint(p));
    return min;
  }

  intersectsPoly(poly) {
    if (!boundsOverlap(this.bounds, poly.bounds)) return false;
    for (let s1 of this.segments) {
      for (let s2 of poly.segments) {
        if (getIntersection(s1.p1, s1.p2, s2.p1, s2.p2)) return true;
      }
    }
    return false;
  }

  containsSegment(seg) {
    const midpoint = average(seg.p1, seg.p2);
    return this.containsPoint(midpoint);
  }

  containsPoint(point) {
    const b = this.bounds;
    if (point.x < b.minX || point.x > b.maxX || point.y < b.minY || point.y > b.maxY) {
      return false;
    }
    // Odd number of crossings from an outside point => inside.
    const outerPoint = new Point(b.minX - 1000.13, b.minY - 1000.71);
    let intersectionCount = 0;
    for (const seg of this.segments) {
      if (getIntersection(outerPoint, point, seg.p1, seg.p2)) intersectionCount++;
    }
    return intersectionCount % 2 == 1;
  }

  drawSegments(ctx) {
    for (const seg of this.segments) {
      seg.draw(ctx, { color: getRandomColor(), width: 5 });
    }
  }

  draw(ctx, { stroke = "blue", lineWidth = 2, fill = "rgba(0,0,255,0.3)", join = "miter" } = {}) {
    ctx.beginPath();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = join;
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) {
      ctx.lineTo(this.points[i].x, this.points[i].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
