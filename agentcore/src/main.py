# AgentCoreのエントリポイント。BedrockAgentCoreAppでAgentのストリーミング呼び出しを定義する。
# OAuth 同意フローが必要な場合は ElicitationBridge 経由で SSE にイベントを注入する。

import asyncio
import json

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from agents.agent import create_agent
from agent.mcp.elicitation_bridge import ElicitationBridge, set_bridge, reset_bridge
from config import ALLOWED_ORIGINS

app = BedrockAgentCoreApp(
    middleware=[
        Middleware(
            CORSMiddleware,
            allow_origins=ALLOWED_ORIGINS,
            allow_methods=["GET", "POST"],
            allow_headers=["*"],
        )
    ]
)

# セッション管理（session_id -> Agent のペア）
sessions: dict = {}
# セッション管理（session_id -> ElicitationBridge のペア）
_session_bridges: dict[str, ElicitationBridge] = {}


def get_or_create_agent(session_id: str):
    """セッションIDに対応するAgentを取得または新規作成する"""
    if session_id not in sessions:
        sessions[session_id] = create_agent()
    return sessions[session_id]


@app.entrypoint
async def invoke(payload, context):
    """AgentCoreのエントリポイント。promptを受け取り、回答をSSEでストリーミングする。
    OAuth 同意が必要な場合は oauth_url / oauth_complete イベントも SSE に流す。
    """
    prompt = payload.get("prompt", "")
    session_id = payload.get("session_id", "default")
    agent = get_or_create_agent(session_id)

    # worker loop を取得してブリッジ・イベントキューを初期化
    loop = asyncio.get_running_loop()
    event_queue: asyncio.Queue = asyncio.Queue()
    bridge = ElicitationBridge(queue=event_queue, loop=loop)

    # コンテキスト変数にセット（asyncio.create_task でも伝播する）
    token = set_bridge(bridge)
    _session_bridges[session_id] = bridge

    async def pump_agent():
        """エージェントのストリームをイベントキューへ転送するタスク"""
        try:
            async for event in agent.stream_async(prompt):
                if "data" in event and isinstance(event["data"], str):
                    await event_queue.put(event["data"])
        finally:
            await event_queue.put(None)  # 完了シグナル

    task = asyncio.create_task(pump_agent())

    try:
        while True:
            item = await event_queue.get()
            if item is None:
                break
            yield item
    finally:
        task.cancel()
        reset_bridge(token)
        _session_bridges.pop(session_id, None)


async def _oauth_complete_handler(request: Request) -> JSONResponse:
    """OAuth コールバック受信エンドポイント。
    AgentCore Identity へ完了を通知し、SSE で oauth_complete を配信する。
    """
    from config import ELICITATION_MODE, REGION

    if ELICITATION_MODE == "in_memory":
        return JSONResponse({"status": "mock"})

    session_id = request.query_params.get("session_id", "default")
    session_uri = request.query_params.get("session_uri", "")
    user_token = request.query_params.get("user_token", "")

    try:
        from bedrock_agentcore.services.identity import IdentityClient, UserTokenIdentifier
        client = IdentityClient(REGION)
        client.complete_resource_token_auth(
            session_uri=session_uri,
            user_identifier=UserTokenIdentifier(user_token=user_token),
        )
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    bridge = _session_bridges.get(session_id)
    if bridge:
        bridge.emit_oauth_complete()

    return JSONResponse({"status": "ok"})


# /oauth-complete ルートを追加（Starlette の Router に直接追加）
app.router.routes.append(
    Route("/oauth-complete", _oauth_complete_handler, methods=["GET"])
)


if __name__ == "__main__":
    app.run()
