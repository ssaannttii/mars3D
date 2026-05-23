#!/usr/bin/env python3
import json
import struct
from pathlib import Path


SOURCE_WIDTH = 5760
SOURCE_HEIGHT = 2880
FACTOR = 4
OUT_WIDTH = SOURCE_WIDTH // FACTOR
OUT_HEIGHT = SOURCE_HEIGHT // FACTOR

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "megt90n000eb.img"
OUT_BIN = ROOT / "data" / "mars-mola-1440x720-int16le.bin"
OUT_META = ROOT / "data" / "mars-mola-1440x720.json"


def main():
    if not SRC.exists():
        raise SystemExit(f"Missing source IMG: {SRC}")

    row_bytes = SOURCE_WIDTH * 2
    sums = [[0] * OUT_WIDTH for _ in range(FACTOR)]
    counts = [[0] * OUT_WIDTH for _ in range(FACTOR)]
    out = bytearray(OUT_WIDTH * OUT_HEIGHT * 2)
    global_min = 999999
    global_max = -999999
    total = 0

    with SRC.open("rb") as f:
        for src_y in range(SOURCE_HEIGHT):
            raw = f.read(row_bytes)
            if len(raw) != row_bytes:
                raise SystemExit(f"Unexpected EOF at source row {src_y}")

            bucket_y = src_y % FACTOR
            acc = sums[bucket_y]
            cnt = counts[bucket_y]
            for src_x in range(SOURCE_WIDTH):
                value = struct.unpack_from(">h", raw, src_x * 2)[0]
                bucket_x = src_x // FACTOR
                acc[bucket_x] += value
                cnt[bucket_x] += 1

            if bucket_y == FACTOR - 1:
                out_y = src_y // FACTOR
                for out_x in range(OUT_WIDTH):
                    block_sum = 0
                    block_count = 0
                    for row in range(FACTOR):
                        block_sum += sums[row][out_x]
                        block_count += counts[row][out_x]
                        sums[row][out_x] = 0
                        counts[row][out_x] = 0

                    value = round(block_sum / block_count)
                    global_min = min(global_min, value)
                    global_max = max(global_max, value)
                    total += value
                    struct.pack_into("<h", out, (out_y * OUT_WIDTH + out_x) * 2, value)

    OUT_BIN.write_bytes(out)
    OUT_META.write_text(
        json.dumps(
            {
                "width": OUT_WIDTH,
                "height": OUT_HEIGHT,
                "sampleType": "int16le",
                "unit": "meter",
                "source": "NASA PDS MGS-M-MOLA-5-MEGDR-L3-V1.0 MEGT90N000EB.IMG",
                "sourceResolution": "16 pixels/degree",
                "derivedResolution": "4 pixels/degree",
                "minimumMeters": global_min,
                "maximumMeters": global_max,
                "meanMeters": round(total / (OUT_WIDTH * OUT_HEIGHT), 2),
                "longitudeRange": [0, 360],
                "latitudeRange": [90, -90],
                "marsRadiusMeters": 3396000,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"Wrote {OUT_BIN} ({OUT_WIDTH}x{OUT_HEIGHT})")
    print(f"Elevation range: {global_min} m to {global_max} m")


if __name__ == "__main__":
    main()
