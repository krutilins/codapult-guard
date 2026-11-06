from company.users import service as users


def invoice(user_id: str) -> str:
    return users.lookup(user_id)
