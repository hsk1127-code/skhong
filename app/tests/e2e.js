// 브라우저 종단 테스트: 엑셀 불러오기 → 편집 → 내보내기 → 백업/복원
//   python3 app/build.py && python3 app/tests/make_fixture.py /tmp/fixture.xlsx /tmp/bom.xlsx /tmp/meeting.xlsx
//   node app/tests/e2e.js /tmp/fixture.xlsx /tmp/bom.xlsx /tmp/meeting.xlsx      (playwright 필요)
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

(async () => {
  const fixture = path.resolve(process.argv[2]);
  const bomFixture = path.resolve(process.argv[3]);
  const meetingFixture = path.resolve(process.argv[4]);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "pd-e2e-"));
  const html = path.resolve(__dirname, "../../프로젝트자료관리.html");
  const ctx = await chromium.launchPersistentContext(path.join(work, "profile"), {
    executablePath: process.env.CHROMIUM_PATH || undefined, acceptDownloads: true, viewport: { width: 1400, height: 900 },
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  // 폴더 지정(File System Access)이 없는 브라우저처럼: 백업·보고서를 내려받기로 저장
  await p.addInitScript(() => { window.showDirectoryPicker = undefined; window.showOpenFilePicker = undefined; });
  await p.goto("file://" + html);

  // 불러오기
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.click("#homeImport")]);
  await fc.setFiles(fixture);
  await p.waitForSelector("#busy", { state: "hidden" });
  await p.waitForSelector(".tabs");
  // 개요는 요약 화면이 기본, 정보 수정에서 입력
  await p.waitForSelector(".ov-hero");
  assert.match(await p.textContent(".ov-hero h2"), /테스트 AMR 도입/);
  assert.strictEqual(await p.locator(".scope-item").count(), 2);
  await p.click("[data-ovmode=edit]");
  assert.strictEqual(await p.inputValue("[data-k=name]"), "테스트_설비");
  // 발주금액·정산 비율
  await p.fill("[data-k=note]", "고객 요청: 도장 색상 별도 협의");
  await p.fill("[data-ck=orderDate]", "2026-09-11");
  await p.type("[data-ck=orderAmount]", "120000000");
  assert.strictEqual(await p.inputValue("[data-ck=orderAmount]"), "120,000,000");
  assert.strictEqual(await p.textContent("#amountWords"), "금 일억이천만원정");
  // 실행목표가·실행가 → 이익
  await p.type("[data-ck=estimateCost]", "85000000");
  await p.type("[data-ck=targetCost]", "80000000");
  await p.type("[data-ck=actualCost]", "90000000");
  // 예상·목표·실제 이익 칸은 없음, 목표 대비만
  assert.doesNotMatch(await p.textContent("#costView"), /예상 이익|목표 이익|실제 이익/);
  // 이익 = 발주금액 − 실행가 (실행 예가보다 더 써도 발주금액보다 적으면 이익), 예가·목표 초과는 ▲ 로 따로 표시
  const cv = await p.textContent("#costView");
  assert.match(cv, /이익 \(발주금액 − 실행가 합계\)30,000,000원120,000,000원 − 90,000,000원 · 이익률 25\.0%/);
  assert.match(cv, /예가 대비▲ 5,000,000원 초과실행가 90,000,000원 − 실행 예가 85,000,000원 · 예상보다 이익 5,000,000원 감소/);
  assert.match(cv, /목표 대비▲ 10,000,000원 초과/);
  // 인건비: M/D × 단가 자동 계산, 칸에 숫자로 보임 (실행가·이익은 그대로)
  await p.fill("[data-md=setup]", "2");
  await p.type("[data-ck=mdRate]", "500000");
  assert.strictEqual(await p.inputValue("[data-ck=laborCost]"), "1,000,000");
  assert.match(await p.textContent("#laborView"), /총 2 M\/D[\s\S]*인건비 1,000,000원/);
  // 재경비·워런티비 = 실행가 × 비율, 실행가 합계 = 실행가 + 인건비 + 재경비 + 워런티비
  await p.fill("[data-rate=overheadRate]", "5");
  await p.fill("[data-rate=warrantyRate]", "2");
  assert.strictEqual(await p.textContent("#amt-overhead"), "4,500,000원");
  assert.match(await p.textContent("#totalView"), /실행가 합계97,300,000원/);
  await p.fill("[data-rate=overheadRate]", ""); await p.fill("[data-rate=warrantyRate]", "");
  await p.click('.preset-chip button:text-is("30 : 70")');
  assert.deepStrictEqual(await p.$$eval(".pay-table [data-amt]", (els) => els.map((e) => e.textContent)), ["36,000,000", "84,000,000"]);
  await p.selectOption(".pay-table tbody tr:first-child [data-pf=status]", "수금완료");
  // 모두 수금완료 → 지급 완료일 칸에 날짜가 실제로 들어감, 하나라도 되돌리면 비워짐
  assert.strictEqual(await p.inputValue("#kdForm [data-k=paidDate]"), "");
  await p.fill(".pay-table tbody tr:nth-child(2) [data-pf=paidDate]", "2026-12-30");
  assert.strictEqual(await p.inputValue("#kdForm [data-k=paidDate]"), "2026-12-30");
  // 정산일을 지우면 그 전 상태(미청구)로 돌아가고 지급 완료일도 비워짐
  await p.fill(".pay-table tbody tr:nth-child(2) [data-pf=paidDate]", "");
  await p.locator(".pay-table tbody tr:nth-child(2) [data-pf=paidDate]").dispatchEvent("change");
  assert.strictEqual(await p.inputValue(".pay-table tbody tr:nth-child(2) [data-pf=status]"), "미청구");
  assert.strictEqual(await p.inputValue("#kdForm [data-k=paidDate]"), "");
  await p.click("[data-ovmode=view]");
  assert.match(await p.textContent(".ov-contract"), /120,000,000원[\s\S]*30%/);
  assert.strictEqual(await p.textContent(".ov-note"), "고객 요청: 도장 색상 별도 협의");
  // 완료 보고서: 엑셀(마감 보고서 양식) 다운로드
  await p.evaluate(() => { window.print = () => { window.__printed = true; }; });
  await p.click("#reportBtn");
  await p.fill("dialog [name=setupDate]", "2026-12-20");
  assert.strictEqual(await p.inputValue("dialog [name=actualCost]"), "90,000,000");
  // 보고서에는 실제·합계 기준·예상·목표 이익 모두 (합계 = 실행가 90,000,000 + 인건비 1,000,000)
  assert.match(await p.textContent("#profitView"), /실제 30,000,000원.*25\.0%.*합계 기준 29,000,000원.*24\.2%.*예상 35,000,000원.*목표 40,000,000원/);
  assert.strictEqual(await p.isChecked("dialog [name=markDone]"), false); // 실수로 완료 처리되지 않도록 기본은 해제
  await p.check("dialog [name=markDone]");
  const [cx] = await Promise.all([p.waitForEvent("download"), p.click("dialog button.primary")]);
  const closingPath = path.join(work, "closing.xlsx");
  await cx.saveAs(closingPath);
  // PDF 인쇄
  await p.click("#reportBtn");
  assert.strictEqual(await p.inputValue("dialog [name=setupDate]"), "2026-12-20");
  await p.fill("dialog [name=summary]", "납품 완료");
  await p.click("dialog >> text=🖨 인쇄 / PDF");
  await p.waitForFunction(() => window.__printed);
  const rp = await p.textContent("#print");
  assert.match(rp, /프로젝트 완료 보고서/);
  assert.match(rp, /금 일억이천만원정/);
  assert.match(rp, /미수금 잔금 70% · 84,000,000원/);
  assert.match(rp, /원가 구성[\s\S]*실행가 합계[\s\S]*91,000,000원/);
  assert.match(rp, /이익 분석[\s\S]*예상[\s\S]*35,000,000원[\s\S]*목표[\s\S]*40,000,000원[\s\S]*실제[\s\S]*30,000,000원[\s\S]*25\.0%[\s\S]*합계 기준[\s\S]*29,000,000원/);
  assert.match(rp, /납품 완료/);
  assert.match(await p.textContent(".page-head h1 .badge"), /완료/);
  await p.click("[data-ovmode=edit]");
  assert.strictEqual(await p.inputValue("[data-k=scope]"), "AMR : 2EA\nCharger : 1EA");

  await p.click(".tabs [data-tab=schedule]");
  // 기본은 한눈에 보기: 단계별 묶음, 오늘 선
  assert.strictEqual(await p.locator(".gv-phase").count(), 2);
  assert.strictEqual(await p.locator(".gv-axis .now-label").count(), 1);
  await p.click("[data-mode=edit]");
  assert.strictEqual(await p.locator(".sched tbody tr").count(), 3);
  assert.strictEqual(await p.locator(".sched tbody tr").nth(1).locator("[data-f=phase]").inputValue(), "사양 협의");
  assert.match(await p.locator(".sched tbody tr").nth(2).locator("[data-c=status]").textContent(), /진행/);

  await p.click(".tabs [data-tab=parts]");
  // 설비별 BOM: 사업 범위(AMR : 2EA, Charger : 1EA)로 설비 생성, 기존 BOM 은 첫 설비로
  assert.deepStrictEqual(await p.$$eval(".unit-chip:not(.sum) b", (b) => b.map((x) => x.textContent)), ["AMR", "Charger"]);
  assert.deepStrictEqual(await p.$$eval("[data-grid^=unit] [data-comp]", (c) => c.map((x) => x.textContent)), ["", "2", "10"]);
  const items = await p.$$eval("[data-grid^=unit] [data-f=item]", (els) => els.map((e) => e.value));
  assert.deepStrictEqual(items, ["■ 지정품 List", "메인제어PC", "말굽센서"]);

  // 업체 BOM 엑셀 가져오기: 영문 머리글 인식, 소제목→구분, 중복 합치기, 되돌리기
  const [bc] = await Promise.all([p.waitForEvent("filechooser"), p.click("#partsImport")]);
  await bc.setFiles(bomFixture);
  await p.waitForSelector("dialog #pv table");
  assert.match(await p.textContent("dialog [name=sheet] option:checked"), /^MakerList/);
  assert.match(await p.textContent("#pvSum"), /4행 → 3행.*중복 1건/);
  await p.selectOption("dialog [name=mode]", "replace");
  await p.click("dialog button.primary");
  await p.waitForSelector("#partsUndo");
  const bom = await p.$$eval("[data-grid^=unit] tbody tr", (trs) => trs.map((tr) =>
    ["kind", "item", "model", "maker", "qty", "note"].map((k) => tr.querySelector(`[data-f=${k}]`).value).join("|")));
  assert.deepStrictEqual(bom, ["|■ 전장||||", "전장|Lidar|Nano Scan3|SICK|2|spare", "전장|Drive|Leadshine|Leadshine|2|Driving",
    "|■ 기구||||", "기구|LM Guide|SSEBL10|Misumi|4|"]);
  assert.strictEqual(await p.locator(".parts-tools .chip").count(), 1);
  await p.click("#partsUndo");
  assert.deepStrictEqual(await p.$$eval("[data-grid^=unit] [data-f=item]", (els) => els.map((e) => e.value)), items);
  // 행을 다른 설비로 옮기고 전체 합계 확인
  await p.locator("[data-grid^=unit] tbody tr").nth(1).locator("[data-moveunit]").selectOption({ label: "→ Charger" });
  await p.click(".unit-chip >> nth=1");
  assert.deepStrictEqual(await p.$$eval("[data-grid^=unit] [data-f=item]", (els) => els.map((e) => e.value)), ["메인제어PC"]);
  await p.click(".unit-chip.sum");
  const sumRows = await p.$$eval(".sum-table tbody tr", (trs) => trs.map((t) => [...t.children].map((td) => td.textContent.trim())));
  assert.deepStrictEqual(sumRows.map((r) => [r[2], r[r.length - 2]]), [["말굽센서", "10"], ["메인제어PC", "1"]]);

  // 사양: 예시(안전 사양)로 구분 추가 → 기본 항목 채움
  await p.click(".tabs [data-tab=spec]");
  // 날짜 없는 추가 시트(설계 및 제작 조건)는 자료 이력이 아니라 사양으로: 제목 → 구분, 문단·작은 표 → 항목
  assert.deepStrictEqual(await p.$$eval(".unit-chip b", (b) => b.map((x) => x.textContent)), ["설계 및 제작 조건"]);
  const doc = await p.$$eval("[data-grid^=spec] tbody tr", (trs) => trs.map((tr) =>
    ["kind", "item", "content", "review"].map((k) => tr.querySelector(`[data-f=${k}]`).value).join("|")));
  assert.deepStrictEqual(doc, ["환경 조건||1) 온도: 22.5 ~ 23.5 °C\n2) 습도: 45 ± 20% R.H|", "업무 Scope|Hardware|로봇 설계\n3D 도면|담당: 외주"]);
  await p.click("#addSpec");
  await p.click('dialog [data-tpl]:text-is("안전 사양")');
  await p.click("dialog button.primary");
  assert.match(await p.textContent(".unit-chip.active"), /안전 사양.*5항목/);
  assert.strictEqual(await p.inputValue("[data-grid^=spec] tbody tr:first-child [data-f=item]"), "비상 정지 (EMO)");
  // 행 선택 삭제 → 전체 삭제
  await p.locator("[data-grid^=spec] [data-sel]").nth(1).check();
  await p.click("[data-grid^=spec] [data-delsel]");
  assert.strictEqual(await p.locator("[data-grid^=spec] [data-sel]").count(), 4);
  await p.click("[data-grid^=spec] [data-delall]");
  assert.strictEqual(await p.locator("[data-grid^=spec] [data-sel]").count(), 0);

  await p.click(".tabs [data-tab=meetings]");
  assert.strictEqual(await p.inputValue("[data-mf=title]"), "고객사 Kick-off");
  assert.strictEqual(await p.inputValue("[data-mf=date]"), "2026-09-16");
  assert.strictEqual(await p.inputValue("[data-mf=kind]"), "비정례");
  assert.strictEqual(await p.inputValue(".actions-table [data-af=text]"), "견적 제출");

  // 다른 양식의 회의록 엑셀 가져오기 → 등록 + Revision 자동 기록, 같은 회의록은 건너뜀
  for (const expectAdded of [1, 0]) {
    const [mc] = await Promise.all([p.waitForEvent("filechooser"), p.click("#importMeeting")]);
    await mc.setFiles(meetingFixture);
    await p.waitForFunction(() => /회의록 \d+건을 등록/.test(document.querySelector("#toast").textContent));
    assert.match(await p.textContent("#toast"), new RegExp(`회의록 ${expectAdded}건을 등록`));
    await p.evaluate(() => (document.querySelector("#toast").textContent = ""));
  }
  assert.strictEqual(await p.inputValue("[data-mf=title]"), "1차 DR 회의");
  assert.strictEqual(await p.inputValue("[data-mf=date]"), "2026-10-06");
  assert.strictEqual(await p.inputValue("[data-mf=place]"), "본사 3층");
  assert.strictEqual(await p.inputValue(".actions-table [data-af=text]"), "수정 도면 송부");
  assert.strictEqual(await p.inputValue(".actions-table [data-af=due]"), "2026-10-13");
  await p.click(".tabs [data-tab=revisions]");
  const revs = await p.$$eval("[data-grid=revisions] [data-f=content]", (els) => els.map((e) => e.value));
  // Revision 은 자료 이력·회의록이 추가될 때만 기록 (BOM 가져오기·정산 설정 등은 기록 안 함)
  assert.deepStrictEqual(revs, ["신규 작성", "1차 DR 회의"]);

  await p.click(".tabs [data-tab=records]");
  assert.strictEqual(await p.textContent(".rec .rec-title"), "전장품 문의");
  assert.strictEqual(await p.locator(".rec .thumb").count(), 1);
  // 자료 등록 → Revision 기록, 제목을 고치면 Revision 도 같이 바뀜
  await p.click("#addRecord");
  await p.fill("dialog [name=title]", "도면 송부");
  await p.click("dialog button.primary");
  await p.click('.rec:has(.rec-title:text-is("도면 송부")) [data-edit]');
  await p.fill("dialog [name=title]", "수정 도면 송부");
  await p.click("dialog button.primary");
  await p.click(".tabs [data-tab=revisions]");
  const revs2 = await p.$$eval("[data-grid=revisions] [data-f=content]", (els) => els.map((e) => e.value));
  assert.deepStrictEqual(revs2.slice(-1), ["수정 도면 송부"]);
  assert.ok(!revs2.includes("도면 송부"));
  await p.click(".tabs [data-tab=records]");

  // 내보내기
  const [x] = await Promise.all([p.waitForEvent("download"), p.click("#exportXlsx")]);
  await x.saveAs(path.join(work, "out.xlsx"));
  const [b] = await Promise.all([p.waitForEvent("download"), p.click("#backupBtn")]);
  await b.saveAs(path.join(work, "backup.zip"));

  // 삭제 후 복원
  await p.click(".tabs [data-tab=overview]");
  await p.click("[data-ovmode=edit]");
  await p.click("#delProject");
  await p.waitForFunction(() => !document.querySelector(".plist .nav"));
  const [rc] = await Promise.all([p.waitForEvent("filechooser"), p.click("#restoreBtn")]);
  await rc.setFiles(path.join(work, "backup.zip"));
  await p.waitForSelector(".plist .nav");
  await p.click(".plist .nav");
  await p.click(".tabs [data-tab=records]");
  await p.waitForFunction(() => document.querySelector(".thumb img")?.naturalWidth > 0);

  // 두 번째 창을 열었다 닫아도(아무것도 안 고침) 저장된 자료를 덮어쓰지 않음
  const n0 = await p.evaluate(() => Store.projects.length);
  const p2 = await ctx.newPage();
  await p2.addInitScript(() => { window.showDirectoryPicker = undefined; });
  await p2.goto("file://" + html);
  await p2.waitForSelector("#side .plist");
  await p2.close({ runBeforeUnload: true });
  await p.reload();
  await p.waitForSelector("#side .plist");
  assert.strictEqual(await p.evaluate(() => Store.projects.length), n0);

  assert.deepStrictEqual(errors, []);
  await ctx.close();
  console.log("OK", path.join(work, "out.xlsx"), path.join(work, "closing.xlsx"));
})().catch((e) => { console.error(e); process.exit(1); });
