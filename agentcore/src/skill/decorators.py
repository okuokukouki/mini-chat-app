# スキル名をツール関数に紐付けるデコレータ。

def skill(name: str):
    """ツール関数にスキル名を紐付ける"""
    def decorator(func):
        func._skill_name = name
        return func
    return decorator
