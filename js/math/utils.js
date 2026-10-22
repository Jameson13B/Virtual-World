// ---------------------------------------------------------------------------
// Math helpers shared by the whole project.
// Points are plain {x, y} objects or Point instances – both work everywhere.
// ---------------------------------------------------------------------------

function getNearestPoint(loc, points, threshold = Number.MAX_SAFE_INTEGER) {
  let minDist = Number.MAX_SAFE_INTEGER;
  let nearest = null;
  for (const point of points) {
    const dist = distance(point, loc);
    if (dist < minDist && dist < threshold) {
      minDist = dist;
      nearest = point;
    }
  }
  return nearest;
}

function getNearestSegment(loc, segments, threshold = Number.MAX_SAFE_INTEGER) {
  let minDist = Number.MAX_SAFE_INTEGER;
  let nearest = null;
  for (const seg of segments) {
    const dist = seg.distanceToPoint(loc);
    if (dist < minDist && dist < threshold) {
      minDist = dist;
      nearest = seg;
    }
  }
  return nearest;
}

function distance(p1, p2) {
  const dx = p1.x - p2.x, dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy); // sqrt (unlike hypot) is identical on every device
}

function average(p1, p2) {
  return new Point((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
}

function dot(p1, p2) {
  return p1.x * p2.x + p1.y * p2.y;
}

function cross(p1, p2) {
  return p1.x * p2.y - p1.y * p2.x;
}

function add(p1, p2) {
  return new Point(p1.x + p2.x, p1.y + p2.y);
}

function subtract(p1, p2) {
  return new Point(p1.x - p2.x, p1.y - p2.y);
}

function scale(p, scaler) {
  return new Point(p.x * scaler, p.y * scaler);
}

function magnitude(p) {
  return Math.sqrt(p.x * p.x + p.y * p.y);
}

function normalize(p) {
  const m = magnitude(p);
  return m === 0 ? new Point(0, 0) : scale(p, 1 / m);
}

// Rotates 90° clockwise on screen (y points down) – i.e. "to the right"
// of someone travelling in direction p.
function perpendicular(p) {
  return new Point(-p.y, p.x);
}

function translate(loc, angle, offset) {
  return new Point(loc.x + Math.cos(angle) * offset, loc.y + Math.sin(angle) * offset);
}

function angle(p) {
  return Math.atan2(p.y, p.x);
}

// Car angle convention: angle 0 faces up (-y), positive turns left.
function headingFromDir(dir) {
  return Math.atan2(-dir.x, -dir.y);
}

function forwardFromHeading(a) {
  return new Point(-Math.sin(a), -Math.cos(a));
}

function getIntersection(A, B, C, D) {
  const tTop = (D.x - C.x) * (A.y - C.y) - (D.y - C.y) * (A.x - C.x);
  const uTop = (C.y - A.y) * (A.x - B.x) - (C.x - A.x) * (A.y - B.y);
  const bottom = (D.y - C.y) * (B.x - A.x) - (D.x - C.x) * (B.y - A.y);

  const eps = 0.001;
  if (Math.abs(bottom) > eps) {
    const t = tTop / bottom;
    const u = uTop / bottom;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      return { x: lerp(A.x, B.x, t), y: lerp(A.y, B.y, t), offset: t };
    }
  }
  return null;
}

function polysIntersect(poly1, poly2) {
  for (let i = 0; i < poly1.length; i++) {
    for (let j = 0; j < poly2.length; j++) {
      const touch = getIntersection(
        poly1[i], poly1[(i + 1) % poly1.length],
        poly2[j], poly2[(j + 1) % poly2.length]
      );
      if (touch) return true;
    }
  }
  return false;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerp2D(A, B, t) {
  return new Point(lerp(A.x, B.x, t), lerp(A.y, B.y, t));
}

function invLerp(a, b, v) {
  return (v - a) / (b - a);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function degToRad(degree) {
  return (degree * Math.PI) / 180;
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Pushes a point away from the viewer to fake perspective height.
function getFake3dPoint(point, viewPoint, height) {
  const dir = normalize(subtract(point, viewPoint));
  const dist = distance(point, viewPoint);
  const scaler = Math.atan(dist / 300) / (Math.PI / 2);
  return add(point, scale(dir, height * scaler));
}

function getRandomColor() {
  const hue = 290 + Math.random() * 260;
  return "hsl(" + hue + ", 100%, 60%)";
}

// Small, fast, seedable PRNG (mulberry32) so generated worlds are repeatable.
function createRNG(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function boundsOf(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function boundsOverlap(a, b, margin = 0) {
  return (
    a.minX - margin <= b.maxX && a.maxX + margin >= b.minX &&
    a.minY - margin <= b.maxY && a.maxY + margin >= b.minY
  );
}

function segmentNear(seg, p, radius) {
  return (
    Math.min(seg.p1.x, seg.p2.x) - radius <= p.x && Math.max(seg.p1.x, seg.p2.x) + radius >= p.x &&
    Math.min(seg.p1.y, seg.p2.y) - radius <= p.y && Math.max(seg.p1.y, seg.p2.y) + radius >= p.y
  );
}

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function isTyping(evt) {
  const t = evt.target;
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}
