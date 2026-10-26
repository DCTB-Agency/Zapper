"""Maakt het app-icoon en het woordmerk uit de logo-afbeelding merk/zapper-logo-bron.webp.

Links in die afbeelding staat het icoon (afgerond vierkant met de Z), rechts het woord ZAPPER.

    pip3 install pillow
    python3 maak_icoon.py

Schrijft naar web/:
    icoon-192.png, icoon-512.png      app-icoon (Android, manifest)
    icoon-maskable-512.png            met extra rand, voor Android dat zelf een vorm uitsnijdt
    apple-touch-icon.png (180)        iPhone/iPad beginscherm
    favicon-32.png                    tabblad in de browser
    logo-woord-donker.png             ZAPPER voor een donkere achtergrond (PER in wit)
    logo-woord-licht.png              ZAPPER voor een lichte achtergrond (PER in donkerblauw)
"""
from pathlib import Path

from PIL import Image

HIER = Path(__file__).resolve().parent
BRON = HIER / "merk" / "zapper-logo-bron.webp"
UIT = HIER / "web"
ICOON_MIDDEN, ICOON_ZIJDE = (391, 430), 600     # het afgeronde vierkant (115-668 x 170-689) met wat marge
WOORD_VAK = (770, 334, 1700, 503)               # ZAPPER (784-1685 x 348-489) met wat marge
INKT_LICHT = (18, 22, 43)                        # kleur van "PER" op een lichte achtergrond


def vierkant(im, midden, zijde):
    x, y = midden
    return im.crop((x - zijde // 2, y - zijde // 2, x + zijde // 2, y + zijde // 2))


def met_rand(im, factor, achtergrond):
    """Icoon kleiner in een groter vlak, zodat een uitgesneden vorm (maskable) niets wegsnijdt."""
    n = int(im.width * factor)
    vlak = Image.new("RGB", (n, n), achtergrond)
    vlak.paste(im, ((n - im.width) // 2, (n - im.height) // 2))
    return vlak


def transparant(im, bg):
    """Haal de donkerblauwe achtergrond weg: hoe verder een pixel van de achtergrond, hoe minder doorzichtig."""
    im = im.convert("RGB")
    uit = Image.new("RGBA", im.size)
    bron, doel = im.load(), uit.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b = bron[x, y]
            a = min(1.0, (abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])) / 200)
            if a < 0.04:
                doel[x, y] = (0, 0, 0, 0)
                continue
            # kleur "ontmengen" van de achtergrond, zodat randen niet blauwig blijven
            kleur = tuple(max(0, min(255, round((c - (1 - a) * k) / a))) for c, k in zip((r, g, b), bg))
            doel[x, y] = (*kleur, round(a * 255))
    return uit


def licht(im):
    """Witte letters (PER) donker maken voor een lichte achtergrond; oranje blijft oranje."""
    uit = im.copy()
    px = uit.load()
    for y in range(uit.height):
        for x in range(uit.width):
            r, g, b, a = px[x, y]
            if a and min(r, g, b) > 150 and max(r, g, b) - min(r, g, b) < 60:  # wit of bijna wit
                px[x, y] = (*INKT_LICHT, a)
    return uit


def main():
    bron = Image.open(BRON).convert("RGB")
    bg = bron.getpixel((5, 5))
    icoon = vierkant(bron, ICOON_MIDDEN, ICOON_ZIJDE)
    for naam, n in [("icoon-512.png", 512), ("icoon-192.png", 192), ("apple-touch-icon.png", 180), ("favicon-32.png", 32)]:
        icoon.resize((n, n), Image.LANCZOS).save(UIT / naam, optimize=True)
    met_rand(icoon, 1.25, bg).resize((512, 512), Image.LANCZOS).save(UIT / "icoon-maskable-512.png", optimize=True)

    woord = transparant(bron.crop(WOORD_VAK), bg)
    woord = woord.crop(woord.getbbox())
    hoogte = 96  # 3x de hoogte in de app (32px)
    woord = woord.resize((round(woord.width * hoogte / woord.height), hoogte), Image.LANCZOS)
    woord.save(UIT / "logo-woord-donker.png", optimize=True)
    licht(woord).save(UIT / "logo-woord-licht.png", optimize=True)
    print("Klaar:", ", ".join(p.name for p in sorted(UIT.glob("*.png"))))


if __name__ == "__main__":
    main()
