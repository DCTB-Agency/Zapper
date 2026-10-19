"""Maakt een VAPID-sleutelpaar voor web-push.

    pip install cryptography
    python3 maak_vapid.py

De publieke sleutel gaat in web/config.js, de private sleutel (PEM) wordt een
GitHub-secret VAPID_PRIVATE_KEY. De sleutels worden ook in .vapid/ bewaard
(staat in .gitignore, dus komt nooit op GitHub).
"""
import base64
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

sleutel = ec.generate_private_key(ec.SECP256R1())
pem = sleutel.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
pub = sleutel.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
pub_b64 = base64.urlsafe_b64encode(pub).rstrip(b"=").decode()

map_ = Path(__file__).resolve().parent / ".vapid"
map_.mkdir(exist_ok=True)
(map_ / "private.pem").write_bytes(pem)
(map_ / "public.txt").write_text(pub_b64 + "\n")

print("Publieke sleutel (in web/config.js als VAPID_PUBLIC_KEY):\n")
print(pub_b64)
print(f"\nPrivate sleutel bewaard in {map_ / 'private.pem'}")
print("Zet de volledige inhoud van dat bestand als GitHub-secret VAPID_PRIVATE_KEY.")
