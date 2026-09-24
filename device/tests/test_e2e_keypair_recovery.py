"""A device must never advertise a public key it can no longer decrypt for.

Observed on the real device (2026-09-11): `device_pubkey` and
`device_privkey_enc` were both present, so the old `ensure_keypair` returned
early — but the private half had been encrypted under an at-rest key that no
longer existed (the seed file is dated *after* it). Every API key the web
sealed to that public key failed to open: the relay was fine, the phone said
"terkirim", the device logged one line, and the assistant stayed mute forever.

The pair is therefore verified, not merely counted: the scalar must decrypt AND
re-derive the advertised public key.
"""

import base64

import pytest

from utils import crypto_box


class FakeCfg(dict):
    """Config stand-in: crypto_box only needs get() + update()."""


def _fresh():
    cfg = FakeCfg()
    crypto_box.ensure_keypair(cfg)
    return cfg


def test_a_new_device_gets_a_usable_pair():
    cfg = _fresh()
    assert crypto_box.keypair_status(cfg) == "ok"
    assert cfg["device_pubkey"] and cfg["device_privkey_enc"]


def test_an_existing_usable_pair_is_left_alone():
    """Boot must not churn the key — a new pubkey invalidates secrets in flight."""
    cfg = _fresh()
    before = cfg["device_pubkey"]
    crypto_box.ensure_keypair(cfg)
    assert cfg["device_pubkey"] == before


def test_missing_halves_report_missing():
    cfg = _fresh()
    pub, priv = cfg["device_pubkey"], cfg["device_privkey_enc"]

    cfg["device_privkey_enc"] = ""
    assert crypto_box.keypair_status(cfg) == "missing"

    cfg["device_privkey_enc"] = priv
    cfg["device_pubkey"] = ""
    assert crypto_box.keypair_status(cfg) == "missing"

    cfg["device_pubkey"] = pub
    assert crypto_box.keypair_status(cfg) == "ok"


def test_private_key_that_will_not_decrypt_is_regenerated():
    """The real failure: a well-formed ciphertext from a key that is gone."""
    cfg = _fresh()
    stale_pub = cfg["device_pubkey"]
    # Shaped like secure_keys' format (so is_ciphertext accepts it) but
    # undecryptable — exactly what a changed at-rest seed leaves behind.
    cfg["device_privkey_enc"] = "v1.AAAAAAAAAAAAAAAA.AAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAA"

    assert crypto_box.keypair_status(cfg) == "unusable"

    crypto_box.ensure_keypair(cfg)
    assert crypto_box.keypair_status(cfg) == "ok"
    assert cfg["device_pubkey"] != stale_pub


@pytest.mark.parametrize("garbage", ["", "not-hex", "0", "zz"])
def test_unparseable_private_key_is_unusable(garbage):
    cfg = _fresh()
    cfg["device_privkey_enc"] = garbage
    assert crypto_box.keypair_status(cfg) in ("missing", "unusable")


def test_mismatched_halves_are_unusable_even_though_both_decrypt():
    """Two valid halves of different pairs are as broken as one that won't open."""
    a, b = _fresh(), _fresh()
    assert a["device_pubkey"] != b["device_pubkey"]

    mixed = FakeCfg(device_pubkey=a["device_pubkey"], device_privkey_enc=b["device_privkey_enc"])
    assert crypto_box.keypair_status(mixed) == "unusable"

    crypto_box.ensure_keypair(mixed)
    assert crypto_box.keypair_status(mixed) == "ok"


def test_unseal_on_an_unusable_pair_returns_empty_not_an_exception():
    cfg = _fresh()
    cfg["device_privkey_enc"] = "v1.AAAAAAAAAAAAAAAA.AAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAA"
    sealed = {
        "alg": "ecdh-p256-aesgcm",
        "epk": base64.b64encode(b"\x04" + b"\x01" * 64).decode(),
        "iv": base64.b64encode(b"\x00" * 12).decode(),
        "ct": base64.b64encode(b"\x00" * 32).decode(),
    }
    assert crypto_box.unseal(cfg, sealed) == ""
