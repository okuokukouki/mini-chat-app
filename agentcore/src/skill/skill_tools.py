# エージェントが使用するスキル系ツール。
# skill_dispatcher: スキル情報を返す（L2）
# skill_executor: ツール種別を判定して実行する（L3）

import json
from strands import tool

from config import GATEWAY_ENDPOINT, REGION
from skill.skill_registry import registry


@tool
def skill_dispatcher(skill_name: str) -> str:
    """指定したスキルの使い方説明と利用可能ツール一覧を返す。

    まずどのスキルが使えるかを調べる場合は、skill_name に空文字を渡してカタログを取得する。

    Args:
        skill_name: スキル名（例: "tavily-search"）。空文字の場合はカタログを返す。

    Returns:
        スキルの手順説明とツール一覧の JSON 文字列。
    """
    if not skill_name:
        catalog = registry.get_catalog()
        return json.dumps({"available_skills": catalog}, ensure_ascii=False, indent=2)

    instructions = registry.load_instructions(skill_name)
    tools = registry.get_tools(skill_name)
    tool_names = [getattr(t, "__name__", str(t)) for t in tools]

    return json.dumps(
        {"instructions": instructions, "available_tools": tool_names},
        ensure_ascii=False,
        indent=2,
    )


@tool
def skill_executor(skill_name: str, tool_name: str, tool_input: str) -> str:
    """スキルのツールを実行する。

    MCP ツール（Gateway 経由）かローカルツールかを自動判定して実行する。

    Args:
        skill_name: スキル名（例: "tavily-search"）。
        tool_name: ツール名（例: "tavily_search"）。
        tool_input: ツールへの入力（JSON 文字列）。

    Returns:
        ツールの実行結果。
    """
    try:
        params = json.loads(tool_input) if isinstance(tool_input, str) else tool_input
    except json.JSONDecodeError:
        params = {"input": tool_input}

    # ローカルツールを先に検索
    for tool_fn in registry.get_tools(skill_name):
        if getattr(tool_fn, "__name__", "") == tool_name:
            return str(tool_fn(**params))

    # ローカルに見つからない場合は Gateway（MCP）経由で実行
    if not GATEWAY_ENDPOINT:
        return f"エラー: GATEWAY_ENDPOINT が設定されていません。skill={skill_name}, tool={tool_name}"

    from agent.gateway.mcp_client import FilteredMCPClient
    client = FilteredMCPClient(GATEWAY_ENDPOINT, REGION)
    gateway_tool_name = f"{skill_name}___{tool_name}"
    return client.call_tool(gateway_tool_name, params)
