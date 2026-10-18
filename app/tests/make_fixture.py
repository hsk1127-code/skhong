"""실제 사용 중인 프로젝트 엑셀과 같은 구조의 테스트용 통합문서를 만든다.

    python3 app/tests/make_fixture.py <출력 경로.xlsx>
"""

import datetime as dt
import io
import sys

import openpyxl
from openpyxl.drawing.image import Image
from PIL import Image as PILImage, ImageDraw


def png(text):
    im = PILImage.new("RGB", (400, 160), "white")
    ImageDraw.Draw(im).text((20, 60), text, fill="black")
    buf = io.BytesIO()
    im.save(buf, "PNG")
    buf.seek(0)
    return Image(buf)


def main(out):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Revision"
    ws.append(["NO", "날짜", "작성자", "내용", "비고"])
    ws.append([1, dt.datetime(2026, 10, 5), "홍길동", "신규 작성", None])
    ws["B2"].number_format = 'mm"월"\\ dd"일"'

    ws = wb.create_sheet("개요")
    ws["A1"] = "설비/품목명: 테스트_설비"
    ws.merge_cells("A1:C2")
    for r, row in enumerate([["분류", "항목", "비고"], ["Project", "테스트 AMR 도입"], ["고객사", "테스트고객"],
                             ["사업 범위", "AMR : 2EA"], [None, "Charger : 1EA"]], start=3):
        for c, v in enumerate(row, start=1):
            ws.cell(r, c, v)
    ws.merge_cells("A6:A7")

    ws = wb.create_sheet("BOM")
    ws["A1"] = "BOM"
    ws.append(["NO", "구분", "품목", "모델명", "업체명", "개수", "비고"])
    ws.append(["지정품 List"])
    ws.merge_cells("A3:G3")
    ws.append(["NO", "구분", "품목", "모델명", "업체명", "개수", "비고"])
    ws.append([1, "제어모듈", "메인제어PC", "Nuvo-7006E", "Neousys", 1, None])
    ws.append([2, "센서", "말굽센서", "PM-R25", "Panasonic", 5, None])

    ws = wb.create_sheet("킥오프 회의록(2026.09.17)")
    ws["B2"] = "회     의     록"
    ws["B5"], ws["E5"], ws["L5"], ws["O5"] = "부 서 명", "영업팀", "작 성자", "홍길동"
    ws["B7"], ws["E7"], ws["L7"], ws["O7"] = "회의일자", "2026.09.16 (수)", "회의장소", "본사 회의실"
    ws["B9"], ws["E9"], ws["L9"], ws["O9"] = "회의시간", "15:00 ~ 18:00", "구분", "  정례  ■ 비정례 "
    ws["B11"], ws["E11"] = "제   목", "고객사 Kick-off"
    ws["B13"], ws["E13"] = "참석자", " - 고객사 : 김담당"
    ws["B18"] = "회 의 내 용"
    ws["B19"], ws["D19"] = "No", "주  요  내  용"
    ws["B20"], ws["D20"] = 1, "개요"
    ws["D21"] = "ⅰ. 회의 목적 : 사양 확정"
    ws["B30"] = "실천 의제"
    ws["B31"], ws["F31"], ws["H31"] = "지 시 내 용", "담 당 자", "기   한"
    ws["B32"], ws["F32"], ws["H32"] = "견적 제출", "영업팀", "미정"
    ws["B34"] = "특이사항"

    ws = wb.create_sheet("전장품 문의(2026.10.06)")
    ws.add_image(png("mail capture"), "A1")

    ws = wb.create_sheet("일정")
    ws["J2"], ws["K2"] = "기준일", dt.datetime(2026, 10, 8)
    for c, v in zip("BDEFGHIJK", ["항목", "세부사항", "비고", "담당자", "시작일", "종료일", "기간", "경과일", "잔여일"]):
        ws[f"{c}3"] = v
    rows = [("사양 협의", "사양협의", "2026-09-11", "2026-09-20"), (None, "- 1차 DR", "2026-10-06", "2026-10-06"),
            ("기구설계", "3D 설계", "2026-09-21", "2099-10-25")]
    for i, (phase, name, s, e) in enumerate(rows, start=4):
        ws[f"C{i}"], ws[f"D{i}"] = phase, name
        ws[f"G{i}"], ws[f"H{i}"] = dt.datetime.fromisoformat(s), dt.datetime.fromisoformat(e)
        ws[f"G{i}"].number_format = ws[f"H{i}"].number_format = "mm-dd-yy"
    ws.merge_cells("C4:C5")
    wb.save(out)


if __name__ == "__main__":
    main(sys.argv[1])
