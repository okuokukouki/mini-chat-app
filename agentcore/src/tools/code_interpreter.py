# AgentCoreのCode Interpreterビルトインツール。コードをサンドボックスで実行する。

from strands import tool
from bedrock_agentcore.tools import CodeInterpreter

from config import REGION
from skill.decorators import skill

# セッションをモジュールレベルで保持し、リクエスト間で再利用する
_interpreter: CodeInterpreter | None = None


def _get_interpreter() -> CodeInterpreter:
    """CodeInterpreterインスタンスをシングルトンで返す"""
    global _interpreter
    if _interpreter is None:
        _interpreter = CodeInterpreter(REGION)
    return _interpreter


def _parse_result(result: dict) -> str:
    """invoke_code_interpreterのレスポンスからテキスト出力を抽出する"""
    parts = []
    for event in result.get("stream", []):
        r = event.get("result", {})
        is_error = r.get("isError", False)
        for item in r.get("content", []):
            item_type = item.get("type", "")
            if item_type == "text":
                prefix = "[エラー] " if is_error else ""
                parts.append(prefix + item.get("text", ""))
            elif item_type == "image":
                parts.append("[画像出力あり]")
    return "\n".join(parts) if parts else "(出力なし)"


@skill("code-interpreter")
@tool
def execute_code(code: str, language: str = "python") -> str:
    """AgentCoreのサンドボックスでコードを実行して出力を返す。

    Args:
        code: 実行するコード。
        language: 実行言語。"python"（デフォルト）、"javascript"、"typescript"から選択。

    Returns:
        実行結果の出力文字列。
    """
    interpreter = _get_interpreter()
    result = interpreter.execute_code(code, language=language)
    return _parse_result(result)
