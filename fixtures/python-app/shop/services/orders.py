from typing import TYPE_CHECKING

from shop.db import session

if TYPE_CHECKING:
    from shop.api import routes


class OrderService:
    def create(self, order: object) -> dict:
        session.save(order)
        return {"status": "created"}
