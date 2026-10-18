# 프로젝트 통합 문서 관리 시스템

여러 프로젝트의 문서를 한곳에서 등록·검색·버전 관리하는 프로그램입니다.

## 방법 1. 설치 없이 바로 사용 (Python 불필요)

[`프로젝트문서관리.html`](프로젝트문서관리.html) 파일 하나를 내려받아 **더블클릭**하면 크롬/엣지에서 바로 실행됩니다.

- 데이터와 첨부 파일은 **그 PC의 브라우저 안**(IndexedDB)에 저장됩니다.
- 다른 PC로 옮기거나 혹시 모를 삭제에 대비해 오른쪽 위 **💾 백업** 버튼으로 백업 파일(.json)을 저장해 두고,
  **📂 복원**으로 다시 불러오세요.
- 브라우저의 "인터넷 사용 기록 삭제"에서 사이트 데이터를 지우면 저장된 문서도 지워지므로 백업을 꼭 해두세요.
- 혼자 또는 한 PC에서 쓸 때 적합합니다. 여러 사람이 함께 쓰려면 방법 2를 사용하세요.

## 방법 2. 서버로 실행 (Python 3.9+, 여러 사람이 공유)

표준 라이브러리만 사용하므로 별도 패키지 설치는 필요 없습니다.

```bash
python3 -m docmanager            # http://127.0.0.1:8000 접속
python3 -m docmanager --port 9000 --data D:/문서관리데이터
python3 -m docmanager --host 0.0.0.0   # 사내망에서 다른 PC도 접속 허용
```

데이터(SQLite DB `docmanager.db`와 첨부 파일 `files/`)는 `--data` 폴더(기본 `./data`)에 저장됩니다.
백업은 이 폴더만 복사하면 됩니다.

## 주요 기능

| 기능 | 설명 |
|---|---|
| 대시보드 | 프로젝트·문서 수, 상태/분류별 현황, 최근 활동 이력 |
| 프로젝트 관리 | 코드, 이름, 상태(계획/진행/보류/완료), PM, 기간, 설명 |
| 문서 대장 | 전체 프로젝트 문서를 통합 조회, 프로젝트·분류·상태 필터와 통합 검색(제목·번호·태그·작성자·최신 본문·파일명) |
| 문서 번호 자동 부여 | `프로젝트코드-분류코드-순번` 예: `ERP2026-DES-001` |
| 버전(개정) 관리 | 개정마다 버전 증가, 변경 사유·작성자·본문·첨부 파일을 이력으로 보관하고 이전 버전 파일도 다운로드 |
| 승인 상태 | 작성중 → 검토중 → 승인 / 폐기, 상태 변경 이력 기록 |
| CSV 내보내기 | 문서 대장을 엑셀에서 바로 열 수 있는 CSV로 저장 |

분류 코드: 기획 PLN, 요구사항 REQ, 설계 DES, 개발 DEV, 테스트 TST, 회의록 MOM, 보고서 RPT, 계약 CTR, 기타 ETC

## REST API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET/POST | `/api/projects` | 프로젝트 목록 / 등록 |
| GET/PUT/DELETE | `/api/projects/{id}` | 프로젝트 조회 / 수정 / 삭제(소속 문서 포함) |
| GET | `/api/documents?project_id=&q=&status=&category=` | 문서 검색 |
| POST | `/api/documents` | 문서 등록 (v1 생성, `file_name` + base64 `file_data`로 첨부) |
| GET/PUT/DELETE | `/api/documents/{id}` | 문서 조회(개정 이력 포함) / 수정 / 삭제 |
| POST | `/api/documents/{id}/revisions` | 새 개정판 등록 |
| GET | `/api/revisions/{id}/file` | 첨부 파일 다운로드 |
| GET | `/api/stats` | 대시보드 통계 |
| GET | `/api/export.csv?project_id=` | 문서 대장 CSV |

## 테스트

```bash
python3 -m unittest discover -s tests -t .
```

## 구조

```
docmanager/
  store.py           # SQLite 저장소 (프로젝트, 문서, 개정, 활동 로그)
  server.py          # HTTP 서버 + JSON API
  static/index.html  # 웹 화면 (단일 페이지)
tests/               # 단위·API 테스트
standalone/
  backend.js         # 브라우저(IndexedDB)용 저장소
  build.py           # 단일 HTML 생성: python3 standalone/build.py
프로젝트문서관리.html  # 생성된 설치 불필요 버전 (직접 수정 금지)
```

> 참고: 인증 기능이 없으므로 신뢰할 수 있는 내부망에서 사용하세요.
