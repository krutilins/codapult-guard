from company.billing import service


def run() -> str:
    return service.invoice("1")
