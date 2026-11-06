from fastapi import APIRouter

from shop.services import orders

from ..schemas import OrderIn

router = APIRouter()


@router.post("/orders")
def create_order(order: OrderIn) -> dict:
    return orders.OrderService().create(order)
