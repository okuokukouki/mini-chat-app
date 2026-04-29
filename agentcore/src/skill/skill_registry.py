# agentcore/skills/ を再帰スキャンして SKILL.md を読み込むレジストリ。
# スキル名 → 説明・手順・ツール関数 のマッピングを管理する。

import os
from pathlib import Path
from typing import Callable

import yaml

# agentcore/skills/ ディレクトリへの絶対パス
_SKILLS_DIR = Path(__file__).parent.parent.parent / "skills"


def _parse_skill_md(path: Path) -> dict:
    """SKILL.md を読み込んで frontmatter と本文を返す"""
    text = path.read_text(encoding="utf-8")
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            meta = yaml.safe_load(parts[1]) or {}
            body = parts[2].strip()
            return {
                "name": meta.get("name", ""),
                "description": meta.get("description", ""),
                "type": meta.get("type", "local"),
                "scopes": meta.get("scopes", []),
                "body": body,
            }
    return {"name": "", "description": "", "type": "local", "scopes": [], "body": text}


def _scan() -> dict[str, dict]:
    """skills/ を再帰スキャンして全 SKILL.md を読み込む"""
    skills: dict[str, dict] = {}
    if not _SKILLS_DIR.exists():
        return skills
    for skill_md in _SKILLS_DIR.rglob("SKILL.md"):
        parsed = _parse_skill_md(skill_md)
        name = parsed["name"] or skill_md.parent.name
        skills[name] = {
            "description": parsed["description"],
            "type": parsed["type"],
            "scopes": parsed["scopes"],
            "instructions": parsed["body"],
            "tools": [],  # bind_tools で後から設定
        }
    return skills


class SkillRegistry:
    def __init__(self):
        self._skills = _scan()

    def get_catalog(self) -> dict[str, str]:
        """スキル名 → 説明の一覧を返す（L1 用）"""
        return {name: info["description"] for name, info in self._skills.items()}

    def load_instructions(self, skill_name: str) -> str:
        """SKILL.md 本文を返す（L2 用）"""
        if skill_name not in self._skills:
            return f"スキル '{skill_name}' が見つかりません。"
        return self._skills[skill_name]["instructions"]

    def bind_tools(self, tools: list[Callable]) -> None:
        """@skill デコレータで紐付けられたツール関数をスキルに登録する"""
        for tool_fn in tools:
            skill_name = getattr(tool_fn, "_skill_name", None)
            if skill_name and skill_name in self._skills:
                self._skills[skill_name]["tools"].append(tool_fn)

    def get_type(self, skill_name: str) -> str:
        """スキルの実行タイプを返す（local / mcp_runtime / gateway）"""
        return self._skills.get(skill_name, {}).get("type", "local")

    def get_scopes(self, skill_name: str) -> list[str]:
        """スキルの OAuth スコープリストを返す"""
        return self._skills.get(skill_name, {}).get("scopes", [])

    def get_tools(self, skill_name: str) -> list[Callable]:
        """スキルに紐付いたツール関数リストを返す（L3 用）"""
        return self._skills.get(skill_name, {}).get("tools", [])


# シングルトンインスタンス
registry = SkillRegistry()
