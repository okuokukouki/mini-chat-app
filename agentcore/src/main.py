# AgentCoreのエントリポイント。BedrockAgentCoreAppでAgentのストリーミング呼び出しを定義する。

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware

from agents.agent import create_agent

app = BedrockAgentCoreApp(
    middleware=[
        Middleware(
            CORSMiddleware,
            allow_origins=["http://localhost:3000"],
            allow_methods=["GET", "POST"],
            allow_headers=["*"],
        )
    ]
)

# セッション管理（session_id -> Agent のペア）
sessions: dict = {}


def get_or_create_agent(session_id: str):
    """セッションIDに対応するAgentを取得または新規作成する"""
    if session_id not in sessions:
        sessions[session_id] = create_agent()
    return sessions[session_id]

@app.entrypoint
async def invoke(payload, context):
    """AgentCoreのエントリポイント。promptを受け取り、回答をSSEでストリーミングする"""
    prompt = payload.get("prompt", "")
    session_id = payload.get("session_id", "default")

    agent = get_or_create_agent(session_id)

    # stream_asyncでトークンを1つずつ yield する
    async for event in agent.stream_async(prompt):
        if "data" in event and isinstance(event["data"], str):
            yield event["data"]


if __name__ == "__main__":
    app.run()
