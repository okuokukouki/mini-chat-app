# ElicitationBridge: OAuth 同意フローのイベント（URL・完了）を SSE ストリームへ橋渡しする。
# スレッドセーフ。asyncio.run_coroutine_threadsafe で worker loop のキューへ書き込む。

import asyncio
from contextvars import ContextVar
from typing import Optional

# リクエストスコープのブリッジをコンテキスト変数で保持（asyncio.create_task でも引き継がれる）
_bridge_ctx: ContextVar[Optional["ElicitationBridge"]] = ContextVar("elicitation_bridge", default=None)


class ElicitationBridge:
    """OAuth URL と完了イベントを asyncio.Queue 経由で SSE ストリームへ転送するブリッジ。"""

    def __init__(self, queue: "asyncio.Queue[Optional[str]]", loop: asyncio.AbstractEventLoop):
        self._queue = queue
        self._loop = loop

    def emit_oauth_url(self, url: str) -> None:
        """OAuth 同意 URL を SSE ストリームへ送信する（スレッドセーフ）。
        dict を直接キューに入れることで、_convert_to_sse が JSON オブジェクトとしてエンコードする。
        """
        event = {"type": "oauth_url", "url": url}
        asyncio.run_coroutine_threadsafe(self._queue.put(event), self._loop)

    def emit_oauth_complete(self) -> None:
        """OAuth 完了イベントを SSE ストリームへ送信する（スレッドセーフ）"""
        event = {"type": "oauth_complete"}
        asyncio.run_coroutine_threadsafe(self._queue.put(event), self._loop)


def get_bridge() -> Optional[ElicitationBridge]:
    """現在のコンテキストのブリッジを取得する"""
    return _bridge_ctx.get()


def set_bridge(bridge: Optional[ElicitationBridge]) -> object:
    """ブリッジをコンテキスト変数にセットし、リセット用トークンを返す"""
    return _bridge_ctx.set(bridge)


def reset_bridge(token: object) -> None:
    """ブリッジのコンテキスト変数をリセットする"""
    _bridge_ctx.reset(token)  # type: ignore[arg-type]
