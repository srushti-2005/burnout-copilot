"""Tiny in-memory stand-in for the supabase-py query builder (tests only)."""
import itertools
from types import SimpleNamespace


class _Q:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.filters, self._order, self._limit = [], None, None
        self._op, self._payload = "select", None

    def select(self, *_a, **_k): self._op = "select"; return self
    def eq(self, c, v): self.filters.append(lambda r, c=c, v=v: r.get(c) == v); return self
    def lt(self, c, v): self.filters.append(lambda r, c=c, v=v: str(r.get(c)) < str(v)); return self
    def is_(self, c, v): self.filters.append(lambda r, c=c: r.get(c) is None); return self
    def order(self, c, desc=False): self._order = (c, desc); return self
    def limit(self, n): self._limit = n; return self
    def range(self, a, b): self._range = (a, b); return self
    def insert(self, row): self._op, self._payload = "insert", dict(row); return self
    def upsert(self, row): self._op, self._payload = "upsert", dict(row); return self
    def update(self, row): self._op, self._payload = "update", dict(row); return self

    def execute(self):
        rows = self.db.tables.setdefault(self.name, [])
        match = [r for r in rows if all(f(r) for f in self.filters)]
        if self._op == "insert":
            r = self._payload
            r.setdefault("id", f"{self.name}-{next(self.db.ids)}")
            r.setdefault("created_at", self.db.clock().isoformat())
            rows.append(r)
            return SimpleNamespace(data=[dict(r)])
        if self._op == "upsert":
            key = "user_id" if self.name == "user_baselines" else "id"
            for r in rows:
                if r.get(key) == self._payload.get(key):
                    r.update(self._payload)
                    return SimpleNamespace(data=[dict(r)])
            rows.append(self._payload)
            return SimpleNamespace(data=[dict(self._payload)])
        if self._op == "update":
            for r in match:
                r.update(self._payload)
            return SimpleNamespace(data=[dict(r) for r in match])
        if self._order:
            c, desc = self._order
            match.sort(key=lambda r: str(r.get(c)), reverse=desc)
        rg = getattr(self, "_range", None)
        if rg:
            match = match[rg[0]: rg[1] + 1]
        if self._limit is not None:
            match = match[: self._limit]
        return SimpleNamespace(data=[dict(r) for r in match])


class FakeSupabase:
    def __init__(self, clock):
        self.tables, self.clock, self.ids = {}, clock, itertools.count(1)

    def table(self, name):
        return _Q(self, name)
