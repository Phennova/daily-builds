"""Convert Natural Earth 110m land (public domain) into land.js: rings of lon/lat quantised to 0.1 degree.
Usage: python tools/make_land.py <ne_110m_land.geojson>   (writes ../land.js next to this folder)
"""
import json, os, sys

src = sys.argv[1]
data = json.load(open(src, encoding="utf-8"))
rings = []
for f in data["features"]:
    g = f["geometry"]
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    for poly in polys:
        for ring in poly:
            flat = []
            for lon, lat in ring:
                flat.append(round(lon * 10))
                flat.append(round(lat * 10))
            rings.append(flat)
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "land.js")
with open(out, "w", encoding="utf-8") as fh:
    fh.write("// Natural Earth 1:110m land polygons (public domain, naturalearthdata.com), lon/lat x10.\n")
    fh.write("var LAND_RINGS=" + json.dumps(rings, separators=(",", ":")) + ";\n")
    fh.write("if(typeof module!=='undefined')module.exports=LAND_RINGS;\n")
print(len(rings), "rings", sum(len(r) for r in rings) // 2, "points", os.path.getsize(out), "bytes")
