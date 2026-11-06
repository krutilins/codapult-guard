from inventory.core import count


def test_count() -> None:
    assert count() == 0
