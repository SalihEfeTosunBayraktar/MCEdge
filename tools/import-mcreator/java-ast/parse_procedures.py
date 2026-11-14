"""Wraps procedure java_code into classes, parses them with JavaAst and counts statement and call shapes."""
import collections
import json
import os
import subprocess
import sys

ROOT = "C:/MyProjects/AI-Assisted/ETREconomy-MCEdge/elements/procedures/"
HERE = os.path.dirname(os.path.abspath(__file__)) + "/work"
SRC = HERE + "/ast-src"
OUT = HERE + "/ast-out"
os.makedirs(SRC, exist_ok=True)
for f in os.listdir(ROOT):
    d = json.load(open(ROOT + f, encoding="utf8"))
    code = "".join(b["fields"].get("code", "") for b in d["program"]["stacks"][0]["blocks"] if b.get("block") == "java_code")
    open(f"{SRC}/{f[:-5]}.java", "w", encoding="utf8").write("class P { Object run() throws Exception {\n" + code + "\n} }\n")
java = "C:/MyProjects/AI-Assisted/MCEdge/.toolchains/jdk-21.0.12.1+1/bin/java.exe"
if not os.path.exists(java):
    java = "java"
r = subprocess.run([java, os.path.dirname(os.path.abspath(__file__)) + "/JavaAst.java", SRC, OUT], capture_output=True, text=True)
print("exit", r.returncode, r.stderr[-600:])
kinds = collections.Counter()
stmts = collections.Counter()
calls = collections.Counter()


def name(n):
    k = n.get("k")
    if k == "IDENTIFIER":
        return n["name"]
    if k == "MEMBER_SELECT":
        return name(n["expression"]) + "." + n["identifier"]
    if k == "METHOD_INVOCATION":
        return name(n["methodSelect"]) + "()"
    if k == "PARENTHESIZED":
        return "(" + name(n["expression"]) + ")"
    if k == "TYPE_CAST":
        return "(cast)" + name(n["expression"])
    if k == "NEW_CLASS":
        return "new " + name(n["identifier"]) + ("{}" if n.get("classBody") else "")
    return k


def walk(n):
    if isinstance(n, list):
        for x in n:
            walk(x)
    elif isinstance(n, dict):
        k = n.get("k")
        kinds[k] += 1
        if k == "METHOD_INVOCATION":
            calls[name(n["methodSelect"]).replace("etreco.procedures.EtrecoModVariables.", "VAR.")[:60]] += 1
        for v in n.values():
            walk(v)


n = 0
for f in os.listdir(OUT):
    t = json.load(open(f"{OUT}/{f}", encoding="utf8"))
    walk(t)
    n += 1
print("parsed", n)
print(kinds.most_common(50))
merged = collections.Counter()
for c, v in calls.items():
    if c.startswith("VAR.get_"):
        c = "VAR.get"
    if c.startswith("VAR.set_"):
        c = "VAR.set"
    merged[c] += v
print(len(merged))
print(merged.most_common(110))
