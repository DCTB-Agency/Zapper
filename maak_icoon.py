"""Tekent het app-icoon (een tv-scherm met een avondmaan) als PNG, zonder extra pakketten."""
import math
import struct
import zlib
from pathlib import Path

BG = (13, 16, 32)
SCHERM = (30, 35, 64)
AMBER = (244, 166, 42)
LICHT = (232, 234, 246)


def teken(n):
    px = []
    for y in range(n):
        rij = bytearray([0])
        for x in range(n):
            u, v = x / n, y / n
            kleur = BG
            # scherm met afgeronde hoeken
            if 0.16 < u < 0.84 and 0.22 < v < 0.72:
                dx = max(0.0, abs(u - 0.5) - 0.28)
                dy = max(0.0, abs(v - 0.47) - 0.19)
                if math.hypot(dx, dy) < 0.06:
                    kleur = SCHERM
                    # maansikkel
                    if math.hypot(u - 0.5, v - 0.47) < 0.15 and math.hypot(u - 0.56, v - 0.42) > 0.12:
                        kleur = AMBER
            # voetje
            if 0.40 < u < 0.60 and 0.76 < v < 0.79:
                kleur = LICHT
            rij += bytes(kleur)
        px.append(bytes(rij))
    raw = b"".join(px)

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    web = Path(__file__).resolve().parent / "web"
    for n in (192, 512):
        (web / f"icoon-{n}.png").write_bytes(teken(n))
    (web / "apple-touch-icon.png").write_bytes(teken(180))
    print("Iconen geschreven.")
