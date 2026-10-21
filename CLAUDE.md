# 프로젝트 자료 관리 (단일 HTML)

- 소스는 `app/src/`, `python3 app/build.py` 로 `프로젝트자료관리.html` 을 만든다.
- **화면에서 계산·표시를 바꾸면 같은 내용을 한 번에 모든 출력에 적용한다** (사용자 요청):
  1. 화면 (개요·계약/정산 카드, 대시보드)
  2. 완료 보고서 대화상자 (`reportDialog` 의 이익 미리보기)
  3. PDF 보고서 (`reportHtml`: KPI · 원가 구성 · 이익 분석 · 예가/목표 대비 · 계약 및 정산)
  4. 완료 보고서 엑셀 (`model.js` 마감 보고서 시트 행·수식·메모, 종합 시트)
  5. 엑셀 내보내기 (`buildWorkbook` 개요 시트)
  - 공통 계산은 `contractInfo` / `closingInfo`, 공통 문구도 `model.js` 에 두고 함께 쓴다.
- 테스트: `app/tests/e2e.js` (Playwright). 바꾼 표시는 위 출력마다 확인을 추가한다.
