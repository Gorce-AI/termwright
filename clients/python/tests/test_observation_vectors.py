from copy import deepcopy

from conftest import load_vectors
from termwright import validate_snapshot


def test_observation_vectors_preserve_unknown_and_half_open_geometry():
    vectors = load_vectors("observations")
    assert vectors["statuses"] == ["known", "absent", "unknown", "unsupported"]
    assert vectors["examples"][2] == {"status": "unknown", "reason": "legacy-unqualified"}
    assert vectors["halfOpenTouch"]["width"] == 0
    cases = {case["name"]: case["expect"] for case in vectors["geometryCases"]}
    assert cases["fully-inside"]["ratio"] == 1
    assert cases["partially-clipped"]["ratio"] == 0.25
    assert cases["touching-outside-edge"]["ratio"] == 0
    assert all(row["reason"] for row in vectors["frameworks"])
    assert validate_snapshot(vectors["qualifiedSnapshot"]).ok

    unmapped = deepcopy(vectors["qualifiedSnapshot"])
    unmapped["hitGrid"]["value"]["regions"][0]["recipientId"] = "missing"
    result = validate_snapshot(unmapped)
    assert not result.ok
    assert result.code == "missing-parent"
