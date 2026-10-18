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
  await p.goto("file://" + html);

  // 불러오기
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.click("#homeImport")]);
  await fc.setFiles(fixture);
  await p.waitForSelector("#busy", { state: "hidden" });
  await p.waitForSelector(".tabs");
  assert.strictEqual(await p.inputValue("[data-k=name]"), "테스트_설비");
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
  const items = await p.$$eval("[data-grid=bom] [data-f=item]", (els) => els.map((e) => e.value));
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
  const bom = await p.$$eval("[data-grid=bom] tbody tr", (trs) => trs.map((tr) =>
    ["kind", "item", "model", "maker", "qty", "note"].map((k) => tr.querySelector(`[data-f=${k}]`).value).join("|")));
  assert.deepStrictEqual(bom, ["|■ 전장||||", "전장|Lidar|Nano Scan3|SICK|2|spare", "전장|Drive|Leadshine|Leadshine|2|Driving",
    "|■ 기구||||", "기구|LM Guide|SSEBL10|Misumi|4|"]);
  assert.strictEqual(await p.locator(".parts-tools .chip").count(), 1);
  await p.click("#partsUndo");
  assert.deepStrictEqual(await p.$$eval("[data-grid=bom] [data-f=item]", (els) => els.map((e) => e.value)), items);

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
  assert.strictEqual(revs.filter((v) => v === "회의록: 1차 DR 회의").length, 1);

  await p.click(".tabs [data-tab=records]");
  assert.strictEqual(await p.textContent(".rec .rec-title"), "전장품 문의");
  assert.strictEqual(await p.locator(".rec .thumb").count(), 1);

  // 내보내기
  const [x] = await Promise.all([p.waitForEvent("download"), p.click("#exportXlsx")]);
  await x.saveAs(path.join(work, "out.xlsx"));
  const [b] = await Promise.all([p.waitForEvent("download"), p.click("#backupBtn")]);
  await b.saveAs(path.join(work, "backup.zip"));

  // 삭제 후 복원
  await p.click(".tabs [data-tab=overview]");
  await p.click("#delProject");
  await p.waitForFunction(() => !document.querySelector(".plist .nav"));
  const [rc] = await Promise.all([p.waitForEvent("filechooser"), p.click("#restoreBtn")]);
  await rc.setFiles(path.join(work, "backup.zip"));
  await p.waitForSelector(".plist .nav");
  await p.click(".plist .nav");
  await p.click(".tabs [data-tab=records]");
  await p.waitForFunction(() => document.querySelector(".thumb img")?.naturalWidth > 0);

  assert.deepStrictEqual(errors, []);
  await ctx.close();
  console.log("OK", path.join(work, "out.xlsx"));
})().catch((e) => { console.error(e); process.exit(1); });
