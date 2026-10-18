"""웹 화면(docmanager/static/index.html)과 브라우저 백엔드(backend.js)를 합쳐
Python 없이 더블클릭으로 실행하는 단일 HTML 파일을 만든다.

    python3 standalone/build.py   ->  프로젝트문서관리.html
"""

import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docmanager", "static", "index.html")
BACKEND = os.path.join(ROOT, "standalone", "backend.js")
OUT = os.path.join(ROOT, "프로젝트문서관리.html")


def replace(text, old, new):
    if old not in text:
        raise SystemExit(f"build: 패턴을 찾을 수 없습니다: {old[:60]!r}")
    return text.replace(old, new)


def main():
    with open(SRC, encoding="utf-8") as f:
        html = f.read()
    with open(BACKEND, encoding="utf-8") as f:
        backend = f.read()

    # 서버 호출(fetch)을 브라우저 백엔드로 교체
    html = re.sub(r"async function api\(path, options = \{\}\) \{.*?\n\}\n", "", html,
                  count=1, flags=re.S)
    html = replace(html, "<script>\n", "<script>\n" + backend + "\n")
    # 첨부 파일은 base64 대신 File 객체를 그대로 IndexedDB에 저장
    html = replace(html,
                   'r.onload = () => resolve({ file_name: file.name, file_data: r.result.split(",")[1] || "" });',
                   'r.onload = () => resolve({ file_name: file.name, file });')
    # 다운로드는 서버 URL 대신 Blob 으로 처리
    html = replace(html,
                   '<a class="btn" href="/api/export.csv${f.project_id ? "?project_id=" + f.project_id : ""}">',
                   '<a class="btn" href="#" id="csvBtn">')
    html = replace(html, '$("#newDoc").onclick = () => openNewDoc(projects);',
                   '$("#newDoc").onclick = () => openNewDoc(projects);\n'
                   '  $("#csvBtn").onclick = (e) => { e.preventDefault(); exportCsv(f.project_id); };')
    html = replace(html, '<a href="/api/revisions/${r.id}/file">', '<a href="#" data-file="${r.id}">')
    html = replace(html, '  if (e.target.matches("[data-close]")) e.target.closest("dialog").close();\n',
                   '  if (e.target.matches("[data-close]")) e.target.closest("dialog").close();\n'
                   '  if (e.target.dataset.file) {\n'
                   '    e.preventDefault();\n'
                   '    downloadRevisionFile(e.target.dataset.file).catch((err) => toast(err.message));\n'
                   '  }\n')
    # 백업/복원 버튼
    html = replace(html, "  </nav>\n</header>",
                   "  </nav>\n"
                   '  <div style="margin-left:auto;display:flex;gap:6px">\n'
                   '    <button class="btn" id="backupBtn" title="모든 데이터와 첨부 파일을 파일 하나로 저장">💾 백업</button>\n'
                   '    <button class="btn" id="restoreBtn" title="백업 파일에서 데이터 복원">📂 복원</button>\n'
                   '    <input type="file" id="restoreFile" accept=".json,application/json" hidden>\n'
                   "  </div>\n</header>")
    html = replace(html, 'api("/api/meta").then(',
                   '$("#backupBtn").onclick = () => api("/api/meta").then(exportBackup)'
                   '.then(() => toast("백업 파일을 저장했습니다.")).catch((e) => toast(e.message));\n'
                   '$("#restoreBtn").onclick = () => $("#restoreFile").click();\n'
                   '$("#restoreFile").onchange = async (e) => {\n'
                   '  const file = e.target.files[0]; e.target.value = "";\n'
                   '  if (!file || !confirm("현재 데이터를 모두 지우고 백업 파일 내용으로 바꿀까요?")) return;\n'
                   '  try { await api("/api/meta"); await importBackup(file); toast("복원했습니다."); refresh(); }\n'
                   '  catch (err) { toast(err.message); }\n'
                   '};\n\n'
                   'api("/api/meta").then(')
    html = replace(html, "<title>프로젝트 문서 관리</title>",
                   "<title>프로젝트 문서 관리</title>\n"
                   "<!-- 자동 생성 파일: standalone/build.py 로 만듭니다. 직접 수정하지 마세요. -->")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"생성 완료: {OUT}")


if __name__ == "__main__":
    main()
