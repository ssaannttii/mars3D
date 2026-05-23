#!/usr/bin/env python3
"""Generate a normal map PNG from the MOLA derived heightfield.

Reads data/mars-mola-1440x720-int16le.bin (signed 16-bit little-endian, meters)
and writes data/mars-mola-normal-1440x720.png and an 8-bit hillshade.
"""
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "mars-mola-1440x720-int16le.bin"
NORMAL_OUT = ROOT / "data" / "mars-mola-normal-1440x720.png"
HILLSHADE_OUT = ROOT / "data" / "mars-mola-hillshade-1440x720.png"

WIDTH = 1440
HEIGHT = 720
MARS_RADIUS_M = 3_396_000.0
SCALE = 4.5  # how much vertical relief to bake into the normals (visual punch)


def main():
    raw = np.fromfile(SRC, dtype="<i2").astype(np.float32).reshape(HEIGHT, WIDTH)

    # meters per pixel at equator
    circumference = 2 * np.pi * MARS_RADIUS_M
    m_per_px_x_eq = circumference / WIDTH
    m_per_px_y = circumference / 2 / HEIGHT

    # latitudes (one per row)
    lat_deg = 90.0 - (np.arange(HEIGHT) + 0.5) * (180.0 / HEIGHT)
    cos_lat = np.cos(np.deg2rad(lat_deg))[:, None]
    m_per_px_x = np.maximum(m_per_px_x_eq * cos_lat, 1.0)

    # Sobel gradients (use np.roll to wrap longitude)
    left = np.roll(raw, 1, axis=1)
    right = np.roll(raw, -1, axis=1)
    up = np.empty_like(raw)
    up[0] = raw[0]
    up[1:] = raw[:-1]
    down = np.empty_like(raw)
    down[-1] = raw[-1]
    down[:-1] = raw[1:]

    dz_dx = (right - left) / (2 * m_per_px_x)
    dz_dy = (down - up) / (2 * m_per_px_y)

    nx = -dz_dx * SCALE
    ny = -dz_dy * SCALE
    nz = np.ones_like(nx)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx /= length
    ny /= length
    nz /= length

    # Encode as RGB normal map (tangent-space convention, +Y up)
    r = ((nx * 0.5) + 0.5)
    g = ((ny * 0.5) + 0.5)
    b = ((nz * 0.5) + 0.5)
    rgb = np.stack([r, g, b], axis=-1)
    rgb = np.clip(rgb * 255, 0, 255).astype(np.uint8)
    Image.fromarray(rgb, "RGB").save(NORMAL_OUT, optimize=True)

    # Hillshade (Lambertian against a tilted sun) for fallback
    sun = np.array([0.6, 0.55, 0.58])
    sun /= np.linalg.norm(sun)
    lambert = np.clip(nx * sun[0] + ny * sun[1] + nz * sun[2], 0, 1)
    shade = (lambert * 255).astype(np.uint8)
    Image.fromarray(shade, "L").save(HILLSHADE_OUT, optimize=True)

    print(f"Wrote {NORMAL_OUT.name} ({WIDTH}x{HEIGHT})")
    print(f"Wrote {HILLSHADE_OUT.name}")


if __name__ == "__main__":
    main()
