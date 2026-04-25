# エージェントの定義。モデルとツールをまとめる。
# Gateway 呼び出しは skill_executor → FilteredMCPClient 経由で行うため、
# ここでは MCPClient を直接 tools に含めない。

from strands import Agent
from strands.models import BedrockModel

from skill.skill_registry import registry
from skill.skill_tools import skill_dispatcher, skill_executor
from tools.code_interpreter import execute_code
from tools.browser import browse_web

# ローカルツールをスキルレジストリに登録（@skill デコレータで紐付け済み）
registry.bind_tools([execute_code, browse_web])


def create_agent() -> Agent:
    """Agentインスタンスを生成して返す"""
    return Agent(
        model=BedrockModel(model_id="us.anthropic.claude-sonnet-4-5-20250929-v1:0"),
        tools=[skill_dispatcher, skill_executor, execute_code, browse_web],
    )
