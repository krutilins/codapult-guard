import { apiBase } from './settings';

export async function loadOrders(): Promise<unknown> {
  const response = await fetch(`${apiBase}/orders`);
  return response.json();
}
