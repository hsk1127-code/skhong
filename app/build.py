"""app/src 의 파일들을 합쳐 더블클릭으로 실행하는 단일 HTML 파일을 만든다.

    python3 app/build.py   ->  프로젝트자료관리.html
"""

import os
import re
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
OUT = os.path.join(os.path.dirname(HERE), "프로젝트자료관리.html")


def main():
    with open(os.path.join(SRC, "index.html"), encoding="utf-8") as f:
        html = f.read()

    def inline(match):
        with open(os.path.join(SRC, match.group(1)), encoding="utf-8") as f:
            return f.read()

    html = re.sub(r"/\*INLINE:([\w.]+)\*/", inline, html)
    # 화면 왼쪽 아래에 만든 날짜·시각을 표시해 최신 파일인지 확인할 수 있게
    html = html.replace("__BUILD_STAMP__", datetime.now().strftime("%Y.%m.%d %H:%M"))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"생성 완료: {OUT} ({len(html.encode('utf-8')) // 1024} KB)")


if __name__ == "__main__":
    main()
