from __future__ import annotations

import uvicorn

from webapp.app import create_app
from webapp.config import Settings


def main() -> None:
    settings = Settings()
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
