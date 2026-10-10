# Removes every existing "@media print { ... }" block from styles.css (brace-matched). Makes styles.css.bak first.
import shutil, sys
p = sys.argv[1] if len(sys.argv) > 1 else "styles.css"
shutil.copy(p, p + ".bak")
s = open(p, encoding="utf-8").read()
out, i, n = [], 0, 0
while True:
    j = s.find("@media print", i)
    if j < 0:
        out.append(s[i:]); break
    out.append(s[i:j])
    k = s.index("{", j); depth = 1; k += 1
    while depth:
        depth += {"{": 1, "}": -1}.get(s[k], 0); k += 1
    i = k; n += 1
open(p, "w", encoding="utf-8").write("".join(out))
print(f"removed {n} @media print block(s)")
