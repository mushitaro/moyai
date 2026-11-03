"""資料ごとの機器の呼び名。同じ機器を、資料と施設で別の名前で書く。"""


def tag_text(e: dict, rules: dict) -> str | None:
    tag = e.get("tag")
    if not tag:
        return None
    if rules["ledger"]["tag_furnace_suffix"] and e["furnace"]:
        return f"{tag}-{e['furnace']}"
    return tag


def ledger_name(e: dict, rules: dict) -> str:
    """機器台帳の名前。機器番号を名前の中に書く（例：誘引通風機（IDF-1））。"""
    tag = tag_text(e, rules)
    if tag is None:
        return e["base_name"]
    return rules["ledger"]["name_format"].format(name=e["base_name"], tag=tag)
