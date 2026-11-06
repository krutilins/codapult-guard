from shop.services.orders import OrderService


def test_create() -> None:
    assert OrderService().create(object())["status"] == "created"
