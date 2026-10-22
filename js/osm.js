// OpenStreetMap import. Works with Overpass API JSON (`[out:json]`).
// 1 metre = 10 world units, so a 100-unit road is ~10 m wide.
const Osm = {
  EXCLUDED: "pedestrian|footway|cycleway|path|service|corridor|track|steps|raceway|bridleway|proposed|construction|elevator|bus_guideway|platform|bus_stop|via_ferrata",

  buildQuery(south, west, north, east) {
    return (
      "[out:json][timeout:60];\n" +
      "(\n" +
      '  way["highway"]["highway"!~"' + Osm.EXCLUDED + '"]["area"!="yes"]' +
      "(" + [south, west, north, east].join(",") + ");\n" +
      ");\n" +
      "out body;\n>;\nout skel;"
    );
  },

  bboxAround(lat, lon, radiusMeters) {
    const dLat = radiusMeters / 111000;
    const dLon = radiusMeters / (111000 * Math.cos(degToRad(lat)));
    return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => +v.toFixed(6));
  },

  async fetchArea(lat, lon, radiusMeters) {
    const query = Osm.buildQuery(...Osm.bboxAround(lat, lon, radiusMeters));
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: "data=" + encodeURIComponent(query),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (!res.ok) throw new Error("Overpass API error " + res.status);
    return res.json();
  },

  parseRoads(data) {
    const elements = data.elements || [];
    const nodes = elements.filter((n) => n.type == "node");
    if (!nodes.length) throw new Error("No nodes found – is this Overpass JSON with 'out body; >; out skel;'?");

    let latSum = 0, lonSum = 0;
    for (const n of nodes) {
      latSum += n.lat;
      lonSum += n.lon;
    }
    const lat0 = latSum / nodes.length, lon0 = lonSum / nodes.length;
    const k = 111000 * 10;
    const cosLat = Math.cos(degToRad(lat0));

    const byId = new Map();
    for (const node of nodes) {
      const x = Math.round((node.lon - lon0) * k * cosLat * 100) / 100;
      const y = Math.round(-(node.lat - lat0) * k * 100) / 100;
      byId.set(node.id, new Point(x, y));
    }

    const used = new Set();
    const seen = new Set();
    const segments = [];
    for (const way of elements.filter((w) => w.type == "way")) {
      const tags = way.tags || {};
      const oneWay = tags.oneway == "yes" || tags.oneway == "1" || tags.oneway == "-1" || tags.junction == "roundabout";
      const reverse = tags.oneway == "-1";
      const ids = way.nodes || [];
      for (let i = 1; i < ids.length; i++) {
        let a = byId.get(ids[i - 1]);
        let b = byId.get(ids[i]);
        if (!a || !b || a === b || a.equals(b)) continue;
        if (reverse) [a, b] = [b, a];
        const key = a.x < b.x || (a.x == b.x && a.y < b.y)
          ? a.x + "," + a.y + "|" + b.x + "," + b.y
          : b.x + "," + b.y + "|" + a.x + "," + a.y;
        if (seen.has(key)) continue;
        seen.add(key);
        used.add(a);
        used.add(b);
        segments.push(new Segment(a, b, oneWay));
      }
    }
    if (!segments.length) throw new Error("No roads found in that data.");
    return { points: [...used], segments };
  },
};
