from inventory import storage


def count() -> int:
    return len(storage.ITEMS)
