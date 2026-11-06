import math
import struct
import sys
import zlib

SIZE = 256
SCALE = SIZE / 128

BG = (30, 41, 59)
BRACE = (251, 191, 36)
KEY = (56, 189, 248)
VALUE = (226, 232, 240)
CHEVRON = (148, 163, 184)


def bezier(p0, p1, p2, n=24):
    pts = []
    for i in range(n + 1):
        t = i / n
        a, b, c = (1 - t) ** 2, 2 * (1 - t) * t, t * t
        pts.append((a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]))
    return pts


def left_brace():
    return (
        bezier((40, 24), (31, 24), (31, 33))
        + bezier((31, 55), (31, 64), (22, 64))
        + bezier((22, 64), (31, 64), (31, 73))
        + bezier((31, 95), (31, 104), (40, 104))
    )


def segment_distance(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy
    t = 0.0 if length2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length2))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


class Stroke:
    def __init__(self, points, half_width, color):
        self.points = points
        self.half_width = half_width
        self.color = color
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        pad = half_width + 1
        self.box = (min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad)

    def distance(self, x, y):
        x0, y0, x1, y1 = self.box
        if x < x0 or x > x1 or y < y0 or y > y1:
            return math.inf
        best = math.inf
        for (ax, ay), (bx, by) in zip(self.points, self.points[1:]):
            best = min(best, segment_distance(x, y, ax, ay, bx, by))
        return best - self.half_width


def rounded_square(x, y, radius):
    qx = abs(x - 64) - (64 - radius)
    qy = abs(y - 64) - (64 - radius)
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - radius


def bar(x0, x1, y, color):
    return Stroke([(x0, y), (x1, y)], 3.4, color)


def shapes():
    brace = left_brace()
    return [
        Stroke(brace, 3.8, BRACE),
        Stroke([(128 - x, y) for x, y in brace], 3.8, BRACE),
        bar(46, 57, 40, KEY),
        bar(64, 84, 40, VALUE),
        Stroke([(45.5, 53.5), (49.5, 58), (53.5, 53.5)], 2.1, CHEVRON),
        bar(59, 73, 56, KEY),
        bar(59, 67, 72, KEY),
        bar(74, 86, 72, VALUE),
        bar(46, 55, 88, KEY),
        bar(62, 80, 88, VALUE),
    ]


def coverage(distance):
    return max(0.0, min(1.0, 0.5 - distance * SCALE))


def render():
    layers = shapes()
    rows = []
    for py in range(SIZE):
        row = bytearray()
        for px in range(SIZE):
            x, y = (px + 0.5) / SCALE, (py + 0.5) / SCALE
            alpha = coverage(rounded_square(x, y, 24))
            r, g, b = BG
            for shape in layers:
                a = coverage(shape.distance(x, y))
                if a:
                    r = r * (1 - a) + shape.color[0] * a
                    g = g * (1 - a) + shape.color[1] * a
                    b = b * (1 - a) + shape.color[2] * a
            row += bytes((round(r), round(g), round(b), round(alpha * 255)))
        rows.append(row)
    return rows


def write_png(path, rows):
    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    raw = b''.join(b'\x00' + bytes(row) for row in rows)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0)))
        f.write(chunk(b'IDAT', zlib.compress(raw, 9)))
        f.write(chunk(b'IEND', b''))


if __name__ == '__main__':
    write_png(sys.argv[1], render())
