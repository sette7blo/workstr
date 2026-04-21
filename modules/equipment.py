"""
modules/equipment.py — Equipment CRUD (equivalent to Feedme's pantry)
"""
from core.db import db, rows_to_list, row_to_dict


def list_equipment():
    with db() as conn:
        rows = conn.execute("SELECT * FROM equipment ORDER BY name").fetchall()
    return rows_to_list(rows)


def add_equipment(name: str, category: str = None, owned: bool = True, notes: str = None) -> dict:
    with db() as conn:
        conn.execute(
            "INSERT INTO equipment (name, category, owned, notes) VALUES (?, ?, ?, ?)",
            (name, category, 1 if owned else 0, notes)
        )
        row = conn.execute("SELECT * FROM equipment WHERE name=?", (name,)).fetchone()
    return row_to_dict(row)


def update_equipment(eq_id: int, data: dict) -> dict | None:
    allowed = {"name", "category", "owned", "notes"}
    fields = {k: v for k, v in data.items() if k in allowed}
    if not fields:
        return None

    sets = ", ".join(f"{k}=?" for k in fields)
    vals = list(fields.values()) + [eq_id]

    with db() as conn:
        conn.execute(f"UPDATE equipment SET {sets}, updated_at=datetime('now') WHERE id=?", vals)
        row = conn.execute("SELECT * FROM equipment WHERE id=?", (eq_id,)).fetchone()
    return row_to_dict(row)


def delete_equipment(eq_id: int) -> bool:
    with db() as conn:
        cur = conn.execute("DELETE FROM equipment WHERE id=?", (eq_id,))
    return cur.rowcount > 0
