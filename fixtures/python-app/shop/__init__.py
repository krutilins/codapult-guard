"""Shop package. Re-exports the order service."""

from .services.orders import OrderService

__all__ = ["OrderService"]
