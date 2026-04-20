🏢 RoomOS 프로젝트 마스터 설계도 (Master Context)
1. 프로젝트 개요 및 미션
목표: 기존 Google Apps Script(GAS) 기반의 '더 스테이' 관리 시스템을 Next.js + Prisma + Supabase 환경의 모던 웹 앱으로 이관 및 고도화.

핵심 가치: 엑셀의 유연함은 유지하되, 웹의 강력한 데이터 정합성과 고도화된 UI/UX를 결합한다.

2. 개발 및 이관 대원칙 (Forward Compatibility)
상태 유지 (No Regression): 최근 VS Code 환경에서 새롭게 구현한 '인수 날짜 기준 정산' 및 '누적 잔액' 로직은 절대로 퇴보시키지 않는다.

데이터 중심 설계: 시트 기반 접근을 지양하고, Prisma 모델 간의 관계(Relation)를 활용한다.

미디어 관리: 기존 DriveApp 방식 대신 Supabase Storage를 활용한다.

3. 원천 소스 (가장 중요: 클로드는 여기를 집중해서 읽을 것)
📄 Code.gs (전체 서버 로직)
여기에 건우님이 갖고 계신 Apps Script의 Code.gs 전체 내용을 복사해서 아래에 붙여넣으세요.

JavaScript
// ============================================================
// RoomOS - Code.gs (V4.0)
// ============================================================

const SPREADSHEET_ID = '1OLTVviv4ZPNRrzS18MJLEx18Sz6KISa6yChRdyIODCA';
const GEMINI_API_KEY = 'AIzaSyDGpMjfKnQohAQj29zLkr4dhun_VovetNY';
const GEMINI_MODEL   = 'gemini-2.0-flash';

const SHEET = {
  ROOM: 'Room Info',
  TENANT: 'Tenant Info',
  PAYMENT: 'Payment Records',
  EXPENSE: 'Expense Records',
  INCOME: 'Extra Income Records',
  DASH: 'Dashboard Cache',
  FINANCE: 'Financial Accounts'
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('RoomOS')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getSpreadsheet() { return SpreadsheetApp.openById(SPREADSHEET_ID); }

function getSheet(name) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d)) return date;
  return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd');
}

function today() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'); }
function thisMonth() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM'); }

function calcDDayDiffGS(todayStr, targetStr) {
  if (!targetStr) return 9999;
  const tToday = new Date(todayStr);
  const tTarget = new Date(targetStr);
  const diff = Math.round((tTarget - tToday) / 86400000);
  return isNaN(diff) ? 9999 : diff;
}

function genId(prefix, sheet, col) {
  const data = sheet.getDataRange().getValues();
  let max = 0;
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][col - 1]);
    const num = parseInt(id.replace(/\D/g, ''), 10);
    if (!isNaN(num) && num > max) max = num;
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

function genYmId(prefix, sheet) {
  const ym = thisMonth().replace('-', '');
  const data = sheet.getDataRange().getValues();
  let max = 0;
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][0]);
    if (id.startsWith(`${prefix}-${ym}-`)) {
      const num = parseInt(id.split('-')[2], 10);
      if (!isNaN(num) && num > max) max = num;
    }
  }
  return `${prefix}-${ym}-${String(max + 1).padStart(4, '0')}`;
}

function sheetToObjects(sheet) {
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(h => String(h).trim());
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      let val = row[i];
      if (val instanceof Date) {
        if (h === '수납 대상 월' || h === '기준 월') {
          val = Utilities.formatDate(val, 'Asia/Seoul', 'yyyy-MM');
        } else {
          val = Utilities.formatDate(val, 'Asia/Seoul', 'yyyy-MM-dd');
        }
      }
      obj[h] = val;
    });
    return obj;
  });
}

function getUniqueCategories(sheetName, colName, defaults) {
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  const cats = new Set(defaults);
  if (data.length > 1) {
    const headers = data[0].map(h => String(h).trim());
    const idx = headers.indexOf(colName);
    if (idx > -1) {
      for (let i = 1; i < data.length; i++) {
        const val = String(data[i][idx]).trim();
        if (val) cats.add(val);
      }
    }
  }
  return Array.from(cats);
}

function safeSetHeaders(sheet, headers) {
  if (!sheet) return;
  const requiredCols = headers.length;
  if (sheet.getMaxColumns() < requiredCols) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), requiredCols - sheet.getMaxColumns());
  }
  const current = sheet.getRange(1, 1, 1, sheet.getMaxColumns()).getValues()[0];
  const needsUpdate = headers.some((h, i) => String(current[i] || '').trim() !== h);
  if (needsUpdate) sheet.getRange(1, 1, 1, requiredCols).setValues([headers]);
}

function fixSheetHeaders() {
  safeSetHeaders(getSheet(SHEET.ROOM), ['호실', '방 타입', '방 컨디션 메모', '이용료', '현 입주자명', '현 입주자 연락 수단', '현 입주자 연락처', '공실 여부', '최근 업데이트일', '사진 링크', '창문 타입', '방향', '면적(평)', '면적(m2)']);
  safeSetHeaders(getSheet(SHEET.TENANT), ['입주자 ID', '입주자명', '연락 수단', '연락처', '현재 호실', '입주일', '퇴실일', '선납/후납', '보증금 여부', '보증금 금액', '수납 예정일', '수납 예정 금액', '입주자 특징/메모', '상태', '주 결제 수단', '현금영수증 여부', '국적', '성별', '직업', '희망 이동 호실', '전입신고', '계약서 링크', '퇴실 예정일', '청소비', '영어이름', '생년월일', '비상연락처_관계', '비상연락처', '기초수급자']);
  safeSetHeaders(getSheet(SHEET.PAYMENT), ['수납 ID', '입주자 ID', '입주자명', '호실', '수납 대상 월', '수납 예정 금액', '수납 회차', '수납일', '실제 수납 금액', '누적 수납 금액', '잔여 미수납 금액', '완납 여부', '메모', '결제수단']);
  safeSetHeaders(getSheet(SHEET.EXPENSE), ['지출 ID', '지출일', '지출금액', '지출 카테고리', '세부 항목명', '지출 대상 호실 (해당 시)', '메모', '결제수단', '금융사명', '증빙자료링크', '정산상태']);
  safeSetHeaders(getSheet(SHEET.INCOME), ['수입 ID', '수입일', '수입금액', '수입 카테고리', '세부 항목명', '메모', '입금수단', '금융사명', '증빙자료링크']);
  safeSetHeaders(getSheet(SHEET.FINANCE), ['ID', '분류', '금융사명', '별칭', '식별번호', '결제일', '소유주', '이용종료일', '연결계좌']);
  safeSetHeaders(getSheet(SHEET.DASH), ['기준 월', '총수납예정', '총매출', '총지출', '순수익', '완납수', '미납수', '공실수', 'Gemini 분석 코멘트', '업데이트일']);
}

function getAppData(month) {
  fixSheetHeaders();
  const targetMonth = month || thisMonth();
  try {
    return {
      rooms: getRooms(),
      tenants: getTenants(),
      finance: sheetToObjects(getSheet(SHEET.FINANCE)),
      expenses: getExpenses(targetMonth),
      incomes: getIncomes(targetMonth),
      roomStatus: getRoomPaymentStatus(targetMonth),
      dashboard: getDashboard(targetMonth),
      categories: getUniqueCategories(SHEET.EXPENSE, '지출 카테고리', ['관리비', '수선유지', '세금', '인건비', '기타']),
      incomeCategories: getUniqueCategories(SHEET.INCOME, '수입 카테고리', ['건조기', '세탁기', '자판기', '이자수익', '기타'])
    };
  } catch (e) {
    throw new Error('서버 데이터 로딩 오류: ' + e.message);
  }
}

// ── 수입 ──────────────────────────────────────────────────────
function getIncomes(targetMonth) {
  const rows = sheetToObjects(getSheet(SHEET.INCOME));
  if (!targetMonth) return rows;
  return rows.filter(r => String(r['수입일']).startsWith(targetMonth));
}

function saveIncome(inc) {
  const sheet = getSheet(SHEET.INCOME);
  if (inc.id) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(inc.id)) {
        sheet.getRange(i + 1, 2, 1, 8).setValues([[
          inc.date, Number(inc.amount), inc.category, inc.detail || '',
          inc.memo || '', inc.payMethod || '미지정', inc.financeName || '',
          inc.receiptUrls !== undefined ? inc.receiptUrls : data[i][8]
        ]]);
        return { ok: true, id: inc.id };
      }
    }
  }
  const id = genYmId('I', sheet);
  sheet.appendRow([id, inc.date, Number(inc.amount), inc.category, inc.detail || '', inc.memo || '', inc.payMethod || '미지정', inc.financeName || '', inc.receiptUrls || '']);
  return { ok: true, id };
}

function deleteIncome(incomeId) {
  const sheet = getSheet(SHEET.INCOME);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(incomeId)) { sheet.deleteRow(i + 1); return { ok: true }; }
  }
  return { ok: false };
}

// ── 호실 ──────────────────────────────────────────────────────
function initRoomsIfEmpty() {
  const sheet = getSheet(SHEET.ROOM);
  const existing = sheet.getDataRange().getValues();
  if (existing.length < 1 || (existing.length === 1 && existing[0][0] !== '호실')) {
    sheet.clearContents();
    sheet.appendRow(['호실', '방 타입', '방 컨디션 메모', '이용료', '현 입주자명', '현 입주자 연락 수단', '현 입주자 연락처', '공실 여부', '최근 업데이트일', '사진 링크', '창문 타입', '방향', '면적(평)', '면적(m2)']);
  }
  const data = sheet.getDataRange().getValues();
  const existingRooms = new Set(data.slice(1).map(r => String(r[0])));
  const roomNos = [];
  for (let i = 401; i <= 422; i++) roomNos.push(String(i));
  for (let i = 501; i <= 522; i++) roomNos.push(String(i));
  roomNos.forEach(no => {
    if (!existingRooms.has(no)) sheet.appendRow([no, '', '', 0, '', '', '', 'Y', today(), '', '', '', '', '']);
  });
  return { ok: true, total: roomNos.length };
}

function getRooms() {
  const sheet = getSheet(SHEET.ROOM);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) initRoomsIfEmpty();
  const rows = sheetToObjects(getSheet(SHEET.ROOM));
  return rows.sort((a, b) => Number(String(a['호실']).replace(/[^0-9]/g, '')) - Number(String(b['호실']).replace(/[^0-9]/g, '')));
}

function updateRoom(roomData) {
  const sheet = getSheet(SHEET.ROOM);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(roomData.호실)) {
      sheet.getRange(i + 1, 1, 1, 14).setValues([[
        roomData.호실,
        roomData['방 타입'] !== undefined ? roomData['방 타입'] : data[i][1],
        roomData['방 컨디션 메모'] !== undefined ? roomData['방 컨디션 메모'] : data[i][2],
        roomData['이용료'] !== undefined ? roomData['이용료'] : data[i][3],
        roomData['현 입주자명'] !== undefined ? roomData['현 입주자명'] : data[i][4],
        roomData['현 입주자 연락 수단'] !== undefined ? roomData['현 입주자 연락 수단'] : data[i][5],
        roomData['현 입주자 연락처'] !== undefined ? roomData['현 입주자 연락처'] : data[i][6],
        roomData['공실 여부'] !== undefined ? roomData['공실 여부'] : data[i][7],
        today(),
        roomData['사진 링크'] !== undefined ? roomData['사진 링크'] : (data[i][9] || ''),
        roomData['창문 타입'] !== undefined ? roomData['창문 타입'] : (data[i][10] || ''),
        roomData['방향'] !== undefined ? roomData['방향'] : (data[i][11] || ''),
        roomData['면적(평)'] !== undefined ? roomData['면적(평)'] : (data[i][12] || ''),
        roomData['면적(m2)'] !== undefined ? roomData['면적(m2)'] : (data[i][13] || '')
      ]]);
      return { ok: true };
    }
  }
  sheet.appendRow([roomData.호실, roomData['방 타입'] || '', roomData['방 컨디션 메모'] || '', roomData['이용료'] || 0, roomData['현 입주자명'] || '', roomData['현 입주자 연락 수단'] || '', roomData['현 입주자 연락처'] || '', roomData['공실 여부'] || 'Y', today(), roomData['사진 링크'] || '', roomData['창문 타입'] || '', roomData['방향'] || '', roomData['면적(평)'] || '', roomData['면적(m2)'] || '']);
  return { ok: true };
}

function updateRoomManageData(payload) {
  const rSheet = getSheet(SHEET.ROOM);
  const rData = rSheet.getDataRange().getValues();
  for (let i = 1; i < rData.length; i++) {
    if (String(rData[i][0]) === String(payload.호실)) {
      if (payload['방 타입'] !== undefined) rSheet.getRange(i + 1, 2).setValue(payload['방 타입']);
      if (payload['방 컨디션 메모'] !== undefined) rSheet.getRange(i + 1, 3).setValue(payload['방 컨디션 메모']);
      if (payload['이용료'] !== undefined) rSheet.getRange(i + 1, 4).setValue(payload['이용료']);
      rSheet.getRange(i + 1, 9).setValue(today());
      if (payload['사진 링크'] !== undefined) rSheet.getRange(i + 1, 10).setValue(payload['사진 링크']);
      if (payload['창문 타입'] !== undefined) rSheet.getRange(i + 1, 11).setValue(payload['창문 타입']);
      if (payload['방향'] !== undefined) rSheet.getRange(i + 1, 12).setValue(payload['방향']);
      if (payload['면적(평)'] !== undefined) rSheet.getRange(i + 1, 13).setValue(payload['면적(평)']);
      if (payload['면적(m2)'] !== undefined) rSheet.getRange(i + 1, 14).setValue(payload['면적(m2)']);
      break;
    }
  }
  if (payload['이용료'] !== undefined) {
    const tSheet = getSheet(SHEET.TENANT);
    const tData = tSheet.getDataRange().getValues();
    for (let i = 1; i < tData.length; i++) {
      if (String(tData[i][4]) === String(payload.호실) && ['거주중', '입실 예정', '퇴실 예정'].includes(String(tData[i][13]).trim())) {
        tSheet.getRange(i + 1, 12).setValue(payload['이용료']);
      }
    }
  }
  return { ok: true };
}

// ── 드라이브 업로드 ──────────────────────────────────────────
function uploadRoomPhotos(roomId, filesBase64) { return uploadFilesToDrive('더스테이_호실사진', `${roomId}호`, filesBase64); }
function uploadTenantContract(tenantId, filesBase64) { return uploadFilesToDrive('더스테이_입주계약서', `계약서_${tenantId}`, filesBase64); }
function uploadExpenseReceipts(timestampId, filesBase64) { return uploadFilesToDrive('더스테이_지출증빙', `EXP_${timestampId}`, filesBase64); }

function uploadFilesToDrive(folderName, prefix, filesBase64) {
  try {
    let folder;
    const folders = DriveApp.getFoldersByName(folderName);
    if (folders.hasNext()) folder = folders.next();
    else folder = DriveApp.createFolder(folderName);
    const urls = [];
    filesBase64.forEach(f => {
      const fileName = `${prefix}_${new Date().getTime()}_${f.name}`;
      const blob = Utilities.newBlob(Utilities.base64Decode(f.data), f.mimeType, fileName);
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      urls.push('https://drive.google.com/uc?id=' + file.getId());
    });
    return { ok: true, urls: urls };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

// ── 입주자 ──────────────────────────────────────────────────
function getTenants() {
  // ✅ 순수 읽기만 담당 — 쓰기 로직 완전 제거
  const sheet = getSheet(SHEET.TENANT);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  return sheetToObjects(sheet);
}
function repairTenantIds() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getSheet(SHEET.TENANT);
    const data = sheet.getDataRange().getValues();

    let maxId = 0;
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][0]);
      if (id.startsWith('T-')) {
        const num = parseInt(id.replace(/\D/g, ''), 10);
        if (!isNaN(num) && num > maxId) maxId = num;
      }
    }

    let repairedCount = 0;
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0] || String(data[i][0]).trim() === '') {
        if (!data[i][1] || String(data[i][1]).trim() === '') continue; // 이름도 없으면 스킵
        maxId++;
        const newId = `T-${String(maxId).padStart(4, '0')}`;
        sheet.getRange(i + 1, 1).setValue(newId);
        data[i][0] = newId;
        repairedCount++;

        const roomNo = data[i][4];
        const status = String(data[i][13]).trim();
        if (roomNo && ['거주중', '입실 예정', '퇴실 예정'].includes(status)) {
          updateRoom({ 호실: roomNo, '현 입주자명': data[i][1], '현 입주자 연락 수단': data[i][2], '현 입주자 연락처': data[i][3], '공실 여부': 'N' });
        }
      }
    }
    SpreadsheetApp.flush();
    return { ok: true, msg: `${repairedCount}건의 ID가 복구되었습니다.` };

  } catch (e) {
    return { ok: false, msg: e.message };
  } finally {
    lock.releaseLock();
  }
}

function addTenant(t) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(8000); // 최대 8초 대기, 초과 시 예외 발생

    const sheet = getSheet(SHEET.TENANT);
    const id = genId('T', sheet, 1); // 잠금 안에서 실행 → 안전
    sheet.appendRow([
      id, t.입주자명, t.연락수단 || '휴대전화', t.연락처, t.현재호실, t.입주일, '',
      t['선납/후납'] || '선납', t['보증금 여부'] || 'N', t['보증금 금액'] || 0,
      t['수납 예정일'] || '', t['수납 예정 금액'] || 0, t['입주자 특징/메모'] || '',
      t.상태 || '거주중', t['주 결제 수단'] || '계좌이체', t['현금영수증 여부'] || '불필요',
      t.국적 || '🇰🇷 대한민국', t.성별 || '미상', t.직업 || '미정',
      t['희망 이동 호실'] || '', t['전입신고'] || '미신고', t['계약서 링크'] || '',
      t['퇴실 예정일'] || '', t['청소비'] || 0, t['영어이름'] || '', t['생년월일'] || '',
      t['비상연락처_관계'] || '', t['비상연락처'] || '', t['기초수급자'] || 'N'
    ]);
    SpreadsheetApp.flush(); // 즉시 시트 반영 → 다음 실행자가 정확한 max를 읽음

    if (['거주중', '입실 예정', '퇴실 예정'].includes(t.상태)) {
      updateRoom({ 호실: t.현재호실, '현 입주자명': t.입주자명, '현 입주자 연락 수단': t.연락수단, '현 입주자 연락처': t.연락처, '공실 여부': 'N', '이용료': t['수납 예정 금액'] });
    }
    return { ok: true, id };

  } catch (e) {
    // waitLock 실패(타임아웃) 또는 내부 에러 모두 여기서 처리
    return { ok: false, msg: '저장 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요. (' + e.message + ')' };
  } finally {
    lock.releaseLock(); // 성공/실패 관계없이 반드시 잠금 해제
  }
}

function updateTenant(t) {
  const sheet = getSheet(SHEET.TENANT);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(t['입주자 ID'])) {
      const prevRoom = data[i][4];
      const prevStatus = String(data[i][13]).trim();
      const newStatus = t.상태 || prevStatus;
      let newRoom = prevRoom;
      if (newStatus !== '퇴실') newRoom = (t.현재호실 !== undefined && t.현재호실 !== '') ? t.현재호실 : prevRoom;
      let wishRooms = t['희망 이동 호실'] !== undefined ? t['희망 이동 호실'] : (data[i][19] || '');
      if (newRoom !== prevRoom && newStatus !== '퇴실') wishRooms = '';

      // 29 columns (indices 0-28)
      sheet.getRange(i + 1, 1, 1, 29).setValues([[
        data[i][0],
        t.입주자명 || data[i][1],
        t.연락수단 || data[i][2],
        t.연락처 || data[i][3],
        newRoom,
        t.입주일 !== undefined ? t.입주일 : data[i][5],
        data[i][6],
        t['선납/후납'] || data[i][7],
        t['보증금 여부'] || data[i][8],
        t['보증금 금액'] !== undefined ? t['보증금 금액'] : data[i][9],
        t['수납 예정일'] !== undefined ? t['수납 예정일'] : data[i][10],
        t['수납 예정 금액'] !== undefined ? t['수납 예정 금액'] : data[i][11],
        t['입주자 특징/메모'] !== undefined ? t['입주자 특징/메모'] : data[i][12],
        newStatus,
        t['주 결제 수단'] || data[i][14] || '계좌이체',
        t['현금영수증 여부'] || data[i][15] || '불필요',
        t.국적 || data[i][16] || '🇰🇷 대한민국',
        t.성별 !== undefined ? t.성별 : (data[i][17] || '미상'),
        t.직업 || data[i][18] || '미정',
        wishRooms,
        t['전입신고'] !== undefined ? t['전입신고'] : (data[i][20] || '미신고'),
        t['계약서 링크'] !== undefined ? t['계약서 링크'] : (data[i][21] || ''),
        t['퇴실 예정일'] !== undefined ? t['퇴실 예정일'] : (data[i][22] || ''),
        t['청소비'] !== undefined ? t['청소비'] : (data[i][23] || 0),
        t['영어이름'] !== undefined ? t['영어이름'] : (data[i][24] || ''),
        t['생년월일'] !== undefined ? t['생년월일'] : (data[i][25] || ''),
        t['비상연락처_관계'] !== undefined ? t['비상연락처_관계'] : (data[i][26] || ''),
        t['비상연락처'] !== undefined ? t['비상연락처'] : (data[i][27] || ''),
        t['기초수급자'] !== undefined ? t['기초수급자'] : (data[i][28] || 'N')
      ]]);

      if (newStatus === '퇴실' && prevStatus !== '퇴실') {
        if (prevRoom) updateRoom({ 호실: prevRoom, '현 입주자명': '', '현 입주자 연락 수단': '', '현 입주자 연락처': '', '공실 여부': 'Y' });
      } else if (['거주중', '입실 예정', '퇴실 예정'].includes(newStatus)) {
        if (newRoom !== prevRoom && prevRoom && prevStatus !== '퇴실') {
          updateRoom({ 호실: prevRoom, '현 입주자명': '', '현 입주자 연락 수단': '', '현 입주자 연락처': '', '공실 여부': 'Y' });
        }
        if (newRoom) {
          updateRoom({ 호실: newRoom, '현 입주자명': t.입주자명 || data[i][1], '현 입주자 연락 수단': t.연락수단 || data[i][2], '현 입주자 연락처': t.연락처 || data[i][3], '공실 여부': 'N', '이용료': t['수납 예정 금액'] !== undefined ? t['수납 예정 금액'] : data[i][11] });
        }
      }
      return { ok: true };
    }
  }
  return { ok: false, msg: '입주자를 찾을 수 없습니다.' };
}

function backendCheckoutTenant(tenantId) {
  const sheet = getSheet(SHEET.TENANT);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(tenantId)) {
      const roomNo = data[i][4];
      sheet.getRange(i + 1, 7).setValue(today());
      sheet.getRange(i + 1, 14).setValue('퇴실');
      if (roomNo) updateRoom({ 호실: roomNo, '현 입주자명': '', '현 입주자 연락 수단': '', '현 입주자 연락처': '', '공실 여부': 'Y' });
      return { ok: true };
    }
  }
  return { ok: false };
}

function backendMoveInTenant(tenantId) {
  const sheet = getSheet(SHEET.TENANT);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(tenantId)) {
      const roomNo = data[i][4];
      sheet.getRange(i + 1, 14).setValue('거주중');
      if (roomNo) updateRoom({ 호실: roomNo, '현 입주자명': data[i][1], '현 입주자 연락 수단': data[i][2], '현 입주자 연락처': data[i][3], '공실 여부': 'N' });
      return { ok: true };
    }
  }
  return { ok: false };
}

function backendDeleteTenant(tenantId) {
  const sheet = getSheet(SHEET.TENANT);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(tenantId)) {
      const roomNo = data[i][4];
      const status = String(data[i][13]).trim();
      sheet.deleteRow(i + 1);
      if (roomNo && status !== '퇴실') updateRoom({ 호실: roomNo, '현 입주자명': '', '현 입주자 연락 수단': '', '현 입주자 연락처': '', '공실 여부': 'Y' });
      return { ok: true };
    }
  }
  return { ok: false };
}

// ── 수납 ────────────────────────────────────────────────────
function getPayments(targetMonth) {
  const rows = sheetToObjects(getSheet(SHEET.PAYMENT));
  if (!targetMonth) return rows;
  return rows.filter(r => String(r['수납 대상 월']).trim().startsWith(targetMonth));
}

function savePayment(p) {
  const sheet = getSheet(SHEET.PAYMENT);
  const id = genYmId('P', sheet);
  sheet.appendRow([id, p.tenantId, p.tenantName, p.roomNo, p.targetMonth, Number(p.expectedAmount), 1, p.payDate, Number(p.amount), 0, 0, 'N', p.memo || '', p.payMethod || '계좌이체']);
  SpreadsheetApp.flush();
  recalculatePayments(p.tenantId, p.targetMonth);
  return { ok: true, id };
}

function updatePaymentRecord(paymentId, date, amountStr, payMethodStr) {
  const sheet = getSheet(SHEET.PAYMENT);
  const data = sheet.getDataRange().getValues();
  const amount = Number(String(amountStr).replace(/[^0-9]/g, '')) || 0;
  let tenantId = '', targetMonth = '';
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(paymentId)) {
      sheet.getRange(i + 1, 8).setValue(date);
      sheet.getRange(i + 1, 9).setValue(amount);
      if (payMethodStr !== undefined) sheet.getRange(i + 1, 14).setValue(payMethodStr);
      tenantId = String(data[i][1]);
      targetMonth = String(data[i][4]);
      break;
    }
  }
  if (tenantId) { SpreadsheetApp.flush(); recalculatePayments(tenantId, targetMonth); return { ok: true }; }
  return { ok: false };
}

function deletePaymentRecord(paymentId) {
  const sheet = getSheet(SHEET.PAYMENT);
  const data = sheet.getDataRange().getValues();
  let tenantId = '', targetMonth = '';
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(paymentId)) {
      tenantId = String(data[i][1]);
      targetMonth = String(data[i][4]);
      sheet.deleteRow(i + 1);
      break;
    }
  }
  if (tenantId) { SpreadsheetApp.flush(); recalculatePayments(tenantId, targetMonth); return { ok: true }; }
  return { ok: false };
}

function recalculatePayments(tenantId, targetMonth) {
  const sheet = getSheet(SHEET.PAYMENT);
  const data = sheet.getDataRange().getValues();
  let expected = 0;
  let rowsToUpdate = [];
  const targetMStr = String(targetMonth).trim();
  for (let i = 1; i < data.length; i++) {
    let cellMonth = data[i][4];
    if (cellMonth instanceof Date) { cellMonth = Utilities.formatDate(cellMonth, 'Asia/Seoul', 'yyyy-MM'); }
    else { cellMonth = String(cellMonth).replace(/\./g, '-').substring(0, 7); }
    if (String(data[i][1]) === String(tenantId) && cellMonth === targetMStr) {
      expected = Number(data[i][5]) || 0;
      const rawDate = data[i][7];
      const parsedDate = rawDate instanceof Date ? rawDate : new Date(String(rawDate));
      rowsToUpdate.push({ rowIdx: i + 1, amount: Number(data[i][8]) || 0, id: data[i][0], date: parsedDate, payMethod: String(data[i][13]) });
    }
  }
  rowsToUpdate.sort((a, b) => a.date - b.date);
  let cumulative = 0;
  for (let j = 0; j < rowsToUpdate.length; j++) {
    cumulative += rowsToUpdate[j].amount;
    let remaining = Math.max(0, expected - cumulative);
    let isPaid = (remaining <= 0 || rowsToUpdate[j].payMethod === '[이전 원장 수납]') ? 'Y' : 'N';
    sheet.getRange(rowsToUpdate[j].rowIdx, 7).setValue(j + 1);
    sheet.getRange(rowsToUpdate[j].rowIdx, 10).setValue(cumulative);
    sheet.getRange(rowsToUpdate[j].rowIdx, 11).setValue(remaining);
    sheet.getRange(rowsToUpdate[j].rowIdx, 12).setValue(isPaid);
  }
}

// ── 수납 현황 ─────────────────────────────────────────────────
function getRoomPaymentStatus(targetMonth) {
  const month = targetMonth || thisMonth();
  const [yyyy, mm] = month.split('-');
  let prevM = Number(mm) - 1; let prevY = Number(yyyy);
  if (prevM < 1) { prevM = 12; prevY -= 1; }
  const prevMonthStr = `${prevY}-${String(prevM).padStart(2, '0')}`;

  const rooms = getRooms();
  const tenants = getTenants();
  const payments = getPayments(month);
  const prevPayments = getPayments(prevMonthStr);

  return rooms.map(room => {
    const tenant = tenants.find(t => String(t['현재 호실']) === String(room['호실']) && ['거주중', '입실 예정', '퇴실 예정'].includes(String(t['상태']).trim()));
    const rType = room['방 타입'] || '미지정';
    const winType = room['창문 타입'] || '-';
    const isVacant = (String(room['공실 여부']).trim().toUpperCase() === 'Y');

    if (!tenant) return { 호실: room['호실'], 방타입: rType, 창문: winType, 공실: true };

    const tPayments = payments.filter(p => String(p['입주자 ID']) === String(tenant['입주자 ID']));
    const tPrevPayments = prevPayments.filter(p => String(p['입주자 ID']) === String(tenant['입주자 ID']));

    const latest = tPayments.sort((a, b) => Number(b['수납 회차']) - Number(a['수납 회차']))[0];
    const prevLatest = tPrevPayments.sort((a, b) => Number(b['수납 회차']) - Number(a['수납 회차']))[0];

    // 이용료: 입주자의 수납 예정 금액 최우선, 없으면 호실 기본 이용료
    const rawTenantAmt = String(tenant['수납 예정 금액'] || '');
    const rawRoomAmt = String(room['이용료'] || '');
    let expected = (Number(rawTenantAmt.replace(/[^0-9]/g, '')) || 0) || (Number(rawRoomAmt.replace(/[^0-9]/g, '')) || 0);

    let prevExpected = expected;
    if (prevLatest && prevLatest['수납 예정 금액'] !== undefined && prevLatest['수납 예정 금액'] !== '') {
      prevExpected = Number(String(prevLatest['수납 예정 금액']).replace(/[^0-9]/g, '')) || 0;
    }

    const prevTotalPaid = tPrevPayments.reduce((s, p) => s + (Number(String(p['실제 수납 금액']).replace(/[^0-9]/g, '')) || 0), 0);
    const carryOver = Math.max(0, prevTotalPaid - prevExpected);

    const currentTotalPaid = tPayments.reduce((s, p) => s + (Number(String(p['실제 수납 금액']).replace(/[^0-9]/g, '')) || 0), 0);
    const totalWithCarryOver = currentTotalPaid + carryOver;
    const balance = totalWithCarryOver - expected;

    return {
      호실: room['호실'], 방타입: rType, 창문: winType, 공실: isVacant,
      입주자ID: tenant['입주자 ID'], 입주자명: tenant['입주자명'],
      연락수단: tenant['연락 수단'], 연락처: tenant['연락처'],
      선후납: tenant['선납/후납'], 보증금여부: tenant['보증금 여부'],
      보증금금액: tenant['보증금 금액'], 청소비: tenant['청소비'],
      수납예정일: tenant['수납 예정일'], 수납예정금액: expected,
      당월수납: currentTotalPaid, 이월금: carryOver,
      총수납액: totalWithCarryOver, 잔액: balance,
      수납회차: latest ? latest['수납 회차'] : 0,
      수납내역: tPayments, 상태: String(tenant['상태']).trim()
    };
  });
}

// ── 대시보드 ─────────────────────────────────────────────────
function getDashboard(targetMonth) {
  const month = targetMonth || thisMonth();
  const [yyyy, mm] = month.split('-');
  let prevM = Number(mm) - 1; let prevY = Number(yyyy);
  if (prevM < 1) { prevM = 12; prevY -= 1; }
  const prevMonthStr = `${prevY}-${String(prevM).padStart(2, '0')}`;

  const payments = getPayments(month);
  const prevPayments = getPayments(prevMonthStr);
  const expensesCurrentMonth = getExpenses(month);
  const incomesCurrentMonth = getIncomes(month);

  const rooms = getRooms();
  const allTenants = getTenants();
  const tenants = allTenants.filter(t => ['거주중', '입실 예정', '퇴실 예정'].includes(String(t['상태']).trim()));

  let totalExpected = 0; let totalRevenue = 0; let paidCount = 0; let unpaidCount = 0;

  tenants.forEach(t => {
    const tPayments = payments.filter(p => String(p['입주자 ID']) === String(t['입주자 ID']));
    const tPrevPayments = prevPayments.filter(p => String(p['입주자 ID']) === String(t['입주자 ID']));
    const latest = tPayments.sort((a, b) => Number(b['수납 회차']) - Number(a['수납 회차']))[0];
    const prevLatest = tPrevPayments.sort((a, b) => Number(b['수납 회차']) - Number(a['수납 회차']))[0];

    let expected = Number(String(t['수납 예정 금액'] || '0').replace(/[^0-9]/g, '')) || 0;
    if (latest && latest['수납 예정 금액'] !== undefined && latest['수납 예정 금액'] !== '') {
      expected = Number(String(latest['수납 예정 금액']).replace(/[^0-9]/g, '')) || 0;
    }
    totalExpected += expected;

    let prevExpected = expected;
    if (prevLatest && prevLatest['수납 예정 금액'] !== undefined && prevLatest['수납 예정 금액'] !== '') {
      prevExpected = Number(String(prevLatest['수납 예정 금액']).replace(/[^0-9]/g, '')) || 0;
    }

    const prevTotalPaid = tPrevPayments.reduce((s, p) => s + (Number(String(p['실제 수납 금액']).replace(/[^0-9]/g, '')) || 0), 0);
    const carryOver = Math.max(0, prevTotalPaid - prevExpected);
    const currentTotalPaid = tPayments.reduce((s, p) => s + (Number(String(p['실제 수납 금액']).replace(/[^0-9]/g, '')) || 0), 0);
    const balance = (currentTotalPaid + carryOver) - expected;

    if (balance >= 0 || (expected === 0 && currentTotalPaid === 0 && carryOver === 0)) { paidCount++; } else { unpaidCount++; }
  });

  payments.forEach(p => {
    if (String(p['결제수단']) !== '[이전 원장 수납]') totalRevenue += (Number(String(p['실제 수납 금액']).replace(/[^0-9]/g, '')) || 0);
  });
  totalRevenue += incomesCurrentMonth.reduce((s, i) => s + (Number(String(i['수입금액']).replace(/[^0-9]/g, '')) || 0), 0);

  const totalExpense = expensesCurrentMonth.reduce((s, e) => s + (Number(String(e['지출금액']).replace(/[^0-9]/g, '')) || 0), 0);
  const netProfit = totalRevenue - totalExpense;
  const vacantCount = rooms.filter(r => (String(r['공실 여부']).trim().toUpperCase() === 'Y') && /\d/.test(String(r['호실']))).length;

  const catMap = {};
  expensesCurrentMonth.forEach(e => {
    const cat = e['지출 카테고리'] || '기타';
    catMap[cat] = (catMap[cat] || 0) + (Number(String(e['지출금액']).replace(/[^0-9]/g, '')) || 0);
  });

  const schedules = [];
  const todayStr = today();
  allTenants.forEach(t => {
    const st = String(t['상태']).trim();
    if (st === '입실 예정' && t['입주일']) {
      const d = calcDDayDiffGS(todayStr, String(t['입주일']));
      schedules.push({ type: 'in', tenantId: t['입주자 ID'], tenantName: t['입주자명'], roomNo: t['현재 호실'], date: String(t['입주일']), dday: d });
    }
    if (st === '퇴실 예정' && t['퇴실 예정일']) {
      const d = calcDDayDiffGS(todayStr, String(t['퇴실 예정일']));
      schedules.push({ type: 'out', tenantId: t['입주자 ID'], tenantName: t['입주자명'], roomNo: t['현재 호실'], date: String(t['퇴실 예정일']), dday: d });
    }
    // 희망 이동 호실 알림
    if (['거주중', '퇴실 예정'].includes(st) && t['희망 이동 호실']) {
      const wishRooms = String(t['희망 이동 호실']).split(',').map(r => r.trim().replace(/[^0-9]/g, '')).filter(r => r);
      wishRooms.forEach(wNo => {
        const wRoom = rooms.find(r => String(r['호실']) === wNo);
        if (wRoom && String(wRoom['공실 여부']).trim().toUpperCase() === 'Y') {
          schedules.push({ type: 'wish', tenantId: t['입주자 ID'], tenantName: t['입주자명'], roomNo: t['현재 호실'], wishRoom: wNo, date: todayStr, dday: 0 });
        }
      });
    }
  });
  schedules.sort((a, b) => a.dday - b.dday);

  const trend = getMonthlyTrend(6);

  const dash = getSheet(SHEET.DASH);
  const cached = sheetToObjects(dash).find(r => String(r['기준 월']) === month);
  let geminiComment = cached && cached['Gemini 분석 코멘트'] ? cached['Gemini 분석 코멘트'] : '';

  return { month, totalExpected, totalRevenue, totalExpense, netProfit, paidCount, unpaidCount, vacantCount, catMap, trend, schedules, geminiComment };
}

function getMonthlyTrend(months) {
  const result = [];
  const now = new Date();
  const rowsExp = sheetToObjects(getSheet(SHEET.EXPENSE));
  const rowsInc = sheetToObjects(getSheet(SHEET.INCOME));
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM');
    const payments = getPayments(ym);
    const expenses = rowsExp.filter(r => String(r['지출일']).startsWith(ym));
    const incomes = rowsInc.filter(r => String(r['수입일']).startsWith(ym));
    let revenue = 0;
    payments.forEach(p => { if (String(p['결제수단']) !== '[이전 원장 수납]') revenue += (Number(String(p['실제 수납 금액']).replace(/[^0-9]/g, '')) || 0); });
    revenue += incomes.reduce((s, inc) => s + (Number(String(inc['수입금액']).replace(/[^0-9]/g, '')) || 0), 0);
    const expense = expenses.reduce((s, e) => s + (Number(String(e['지출금액']).replace(/[^0-9]/g, '')) || 0), 0);
    result.push({ month: ym, revenue, expense, profit: revenue - expense });
  }
  return result;
}

function analyzeWithGemini(month) {
  const data = getDashboard(month);
  const prompt = `당신은 프리미엄 공간 대여 비즈니스 전문 재무 분석가입니다. 아래 데이터를 분석하고 한국어로 간결하게 3~5문장으로 핵심 인사이트와 운영 제안을 알려주세요.\n[${month} 현황]\n- 총 수납 예정: ${data.totalExpected.toLocaleString()}원\n- 실제 총 매출: ${data.totalRevenue.toLocaleString()}원\n- 총 지출: ${data.totalExpense.toLocaleString()}원\n- 순수익: ${data.netProfit.toLocaleString()}원\n- 완납/미납/공실: ${data.paidCount}/${data.unpaidCount}/${data.vacantCount}개\n분석 결과를 실용적이고 구체적으로 작성해주세요.`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const payload = { contents: [{ parts: [{ text: prompt }] }] };
  const options = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };
  try {
    const res = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(res.getContentText());
    const comment = json.candidates?.[0]?.content?.parts?.[0]?.text || 'AI 분석 불가';
    // upsert Dashboard Cache
    const dash = getSheet(SHEET.DASH);
    const dashData = dash.getDataRange().getValues();
    let found = false;
    for (let i = 1; i < dashData.length; i++) {
      if (String(dashData[i][0]) === String(month)) {
        dash.getRange(i + 1, 1, 1, 10).setValues([[month, data.totalExpected, data.totalRevenue, data.totalExpense, data.netProfit, data.paidCount, data.unpaidCount, data.vacantCount, comment, today()]]);
        found = true; break;
      }
    }
    if (!found) {
      dash.appendRow([month, data.totalExpected, data.totalRevenue, data.totalExpense, data.netProfit, data.paidCount, data.unpaidCount, data.vacantCount, comment, today()]);
    }
    return { ok: true, comment };
  } catch (e) {
    return { ok: false, comment: 'AI 오류: ' + e.message };
  }
}

// ── 지출 ────────────────────────────────────────────────────
// 당월 지출만 반환 (미정산 이중계산 버그 수정)
function getExpenses(targetMonth) {
  const rows = sheetToObjects(getSheet(SHEET.EXPENSE));
  if (!targetMonth) return rows;
  return rows.filter(r => String(r['지출일']).startsWith(targetMonth));
}

// 카드 정산 화면용: 미정산 전체 조회
function getUnsettledExpenses() {
  const rows = sheetToObjects(getSheet(SHEET.EXPENSE));
  return rows.filter(r => String(r['정산상태']) === '미정산');
}

function saveExpense(e) {
  const sheet = getSheet(SHEET.EXPENSE);
  if (e.id) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(e.id)) {
        sheet.getRange(i + 1, 2, 1, 10).setValues([[
          e.date, Number(e.amount), e.category, e.detail || '', e.roomNo || '', e.memo || '',
          e.payMethod || '미지정', e.financeName || '',
          e.receiptUrls !== undefined ? e.receiptUrls : data[i][9],
          e.settleStatus || data[i][10]
        ]]);
        return { ok: true, id: e.id };
      }
    }
  }
  const id = genYmId('E', sheet);
  sheet.appendRow([id, e.date, Number(e.amount), e.category, e.detail || '', e.roomNo || '', e.memo || '', e.payMethod || '미지정', e.financeName || '', e.receiptUrls || '', e.settleStatus || '정산완료']);
  return { ok: true, id };
}

function deleteExpense(expenseId) {
  const sheet = getSheet(SHEET.EXPENSE);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(expenseId)) { sheet.deleteRow(i + 1); return { ok: true }; }
  }
  return { ok: false };
}

// ── 자산 ────────────────────────────────────────────────────
function getFinancialAccounts() { return sheetToObjects(getSheet(SHEET.FINANCE)); }

function saveFinancialAccount(acc) {
  getSheet(SHEET.FINANCE).appendRow([`F-${new Date().getTime()}`, acc.type, acc.brand, acc.alias, acc.number, acc.payDay, acc.owner, acc.cutOffDay || '', acc.linkedAccount || '']);
  return { ok: true };
}

function updateFinancialAccount(acc) {
  const sheet = getSheet(SHEET.FINANCE);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(acc.id)) {
      sheet.getRange(i + 1, 2, 1, 8).setValues([[acc.type, acc.brand, acc.alias, acc.number || '', acc.payDay || '', acc.owner || '', acc.cutOffDay || '', acc.linkedAccount || '']]);
      return { ok: true };
    }
  }
  return { ok: false };
}

function deleteFinancialAccount(id) {
  const sheet = getSheet(SHEET.FINANCE);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) { sheet.deleteRow(i + 1); return { ok: true }; }
  }
  return { ok: false };
}

function settleCardExpenses(brand) {
  const sheet = getSheet(SHEET.EXPENSE);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const expBrand = String(data[i][8]);
    if (String(data[i][7]) === '신용카드' && (expBrand === brand || expBrand.startsWith(brand.split('(')[0].trim())) && String(data[i][10]) === '미정산') {
      sheet.getRange(i + 1, 11).setValue('정산완료');
    }
  }
  return { ok: true };
}

// ── 마스터 데이터 ────────────────────────────────────────────
function updateMasterData(payload) {
  const { type, oldVal, newVal, action } = payload;
  if (type === 'job') {
    const sheet = getSheet(SHEET.TENANT);
    const data = sheet.getDataRange().getValues();
    let updatedCount = 0;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][18]).trim() === String(oldVal).trim()) {
        sheet.getRange(i + 1, 19).setValue(action === 'edit' ? newVal : '미정');
        updatedCount++;
      }
    }
    return { ok: true, msg: `${updatedCount}명의 직업 정보가 업데이트되었습니다.` };
  } else if (type === 'category') {
    const sheet = getSheet(SHEET.EXPENSE);
    const data = sheet.getDataRange().getValues();
    let updatedCount = 0;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][3]).trim() === String(oldVal).trim()) {
        sheet.getRange(i + 1, 4).setValue(action === 'edit' ? newVal : '기타');
        updatedCount++;
      }
    }
    const incSheet = getSheet(SHEET.INCOME);
    const incData = incSheet.getDataRange().getValues();
    let incCount = 0;
    for (let i = 1; i < incData.length; i++) {
      if (String(incData[i][3]).trim() === String(oldVal).trim()) {
        incSheet.getRange(i + 1, 4).setValue(action === 'edit' ? newVal : '기타');
        incCount++;
      }
    }
    return { ok: true, msg: `지출 ${updatedCount}건, 수입 ${incCount}건의 카테고리가 업데이트되었습니다.` };
  
  // ▼ 방문 경로(route) 마스터 데이터 로직 추가 ▼
  } else if (type === 'route') {
    const sheet = getSheet(SHEET.TENANT);
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h).trim());
    const colIdx = headers.indexOf('방문 경로');
    
    if (colIdx === -1) return { ok: true, msg: '방문 경로 컬럼이 아직 없습니다.' }; // 에러 방지
    
    let updatedCount = 0;
    if (action === 'edit' || action === 'delete') {
      const targetVal = action === 'edit' ? newVal : ''; // 삭제면 빈칸으로 초기화
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][colIdx]).trim() === String(oldVal).trim()) {
          sheet.getRange(i + 1, colIdx + 1).setValue(targetVal);
          updatedCount++;
        }
      }
    }
    return { ok: true, msg: `${updatedCount}건의 방문 경로가 업데이트/초기화되었습니다.` };
  }
  // ▲ 여기까지 ▲

  return { ok: false, msg: '잘못된 요청입니다.' };
}
// [Code.gs 맨 아래에 추가] 입주자 보증금만 따로 업데이트
function updateTenantDepositOnly(tenantId, depositAmt) {
  const sheet = getSheet(SHEET.TENANT);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(tenantId)) {
      sheet.getRange(i + 1, 9).setValue('Y'); // 보증금 여부
      sheet.getRange(i + 1, 10).setValue(depositAmt); // 보증금 금액
      return { ok: true };
    }
  }
  return { ok: false };
}


📄 index.html (전체 UI 로직)
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<title>RoomOS</title>
<link href="https://fonts.googleapis.com/css2?family=Pretendard:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root { --bg:#0d0f14; --bg2:#13161e; --bg3:#1a1e28; --border:#252a38; --border2:#2e3448; --text:#e8eaf0; --text2:#8b92a8; --text3:#555e78; --accent:#4f7fff; --accent2:#7c5cfc; --green:#22c98a; --red:#ff5370; --yellow:#ffb830; --card-r:14px; --transition:.18s cubic-bezier(.4,0,.2,1); --mono:'JetBrains Mono',monospace; }
body { font-family:'Pretendard',sans-serif; background:var(--bg); color:var(--text); min-height:100vh; -webkit-font-smoothing:antialiased; overflow-x:hidden; }
button { cursor:pointer; border:none; font-family:inherit; } input, select, textarea { font-family:inherit; } a { color:inherit; text-decoration:none; }
::-webkit-scrollbar { width:6px; height:6px; } ::-webkit-scrollbar-track { background:var(--bg2); } ::-webkit-scrollbar-thumb { background:var(--border2); border-radius:3px; }
.app-wrap { display:flex; flex-direction:column; min-height:100vh; }
.header { position:sticky; top:0; z-index:100; background:rgba(13,15,20,.92); backdrop-filter:blur(16px); border-bottom:1px solid var(--border); padding:0 24px; display:flex; align-items:center; gap:16px; height:60px; }
.header-logo { font-size:1rem; font-weight:700; letter-spacing:-.02em; background:linear-gradient(120deg,var(--accent),var(--accent2)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; white-space:nowrap; }
.header-month { margin-left:auto; display:flex; align-items:center; gap:6px; }
.btn-month-nav { background:var(--bg3); border:1px solid var(--border); color:var(--text2); border-radius:6px; width:28px; height:28px; display:flex; align-items:center; justify-content:center; transition:var(--transition); } .btn-month-nav:hover { background:var(--bg2); color:var(--text); border-color:var(--accent); }
.month-input { background:var(--bg3); border:1px solid var(--border); color:var(--text); border-radius:8px; padding:4px 8px; font-size:.95rem; text-align:center; font-family:var(--mono); width:125px; outline:none; }
.tab-nav { display:flex; gap:2px; padding:12px 24px 0; background:var(--bg); overflow-x:auto; scrollbar-width:none; } .tab-nav::-webkit-scrollbar { display:none; }
.tab-btn { flex-shrink:0; padding:10px 20px; border-radius:10px 10px 0 0; background:transparent; color:var(--text2); font-size:.88rem; font-weight:500; transition:var(--transition); } .tab-btn:hover { color:var(--text); background:var(--bg3); } .tab-btn.active { background:var(--bg2); color:var(--accent); font-weight:600; border-bottom:none; }
.sub-nav { display:flex; gap:8px; margin-bottom:20px; border-bottom:1px solid var(--border); padding-bottom:12px; overflow-x:auto; scrollbar-width:none; white-space:nowrap; } .sub-nav::-webkit-scrollbar { display:none; }
.sub-btn { background:transparent; color:var(--text2); font-size:.9rem; font-weight:600; padding:6px 12px; border-radius:6px; transition:var(--transition); } .sub-btn:hover { color:var(--text); background:var(--bg3); } .sub-btn.active { color:var(--accent); background:rgba(79,127,255,.12); }
.main { flex:1; padding:24px; background:var(--bg2); border-top:1px solid var(--border); }
.tab-panel { display:none; } .tab-panel.active { display:block; animation:fadeIn .2s ease; } @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
.card { background:var(--bg3); border:1px solid var(--border); border-radius:var(--card-r); padding:20px; } .card-title { font-size:.78rem; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--text3); margin-bottom:12px; }
.grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; } .grid-3 { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; } .grid-4 { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; }
@media(max-width:768px) { .grid-2, .grid-3, .grid-4 { grid-template-columns:1fr!important; } .main { padding:16px; } .tab-nav { padding:8px 16px 0; } .header { padding:0 16px; height:54px; gap:8px; } .header-logo { font-size:.9rem; } .card, .stat-card { padding:16px; } }
.stat-card { background:var(--bg3); border:1px solid var(--border); border-radius:var(--card-r); padding:20px; display:flex; flex-direction:column; gap:8px; } .stat-label { font-size:.75rem; color:var(--text2); font-weight:500; letter-spacing:.06em; text-transform:uppercase; } .stat-val { font-size:1.6rem; font-weight:700; font-family:var(--mono); letter-spacing:-.02em; } .stat-val.green { color:var(--green); } .stat-val.red { color:var(--red); } .stat-val.blue { color:var(--accent); } .stat-val.purple { color:var(--accent2); } .stat-sub { font-size:.78rem; color:var(--text3); }
.section-title { font-size:1rem; font-weight:700; margin-bottom:16px; display:flex; align-items:center; gap:8px; } .section-title::before { content:''; display:block; width:3px; height:18px; background:linear-gradient(180deg,var(--accent),var(--accent2)); border-radius:2px; }
.form-group { display:flex; flex-direction:column; gap:6px; } .form-label { font-size:.8rem; color:var(--text2); font-weight:500; } .form-input, .form-select, .form-textarea { background:var(--bg); border:1px solid var(--border2); color:var(--text); border-radius:8px; padding:10px 14px; font-size:.9rem; width:100%; transition:var(--transition); } .form-input:focus, .form-select:focus, .form-textarea:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px rgba(79,127,255,.15); } .form-input:disabled { background:var(--bg2); cursor:not-allowed; opacity:0.6; } .form-textarea { resize:vertical; min-height:80px; }
.form-input[readonly] { background:var(--bg2); color:var(--text2); cursor:default; }
.form-select:disabled { background:var(--bg2); cursor:not-allowed; opacity:0.6; }
.btn { padding:10px 20px; border-radius:8px; font-size:.88rem; font-weight:600; display:inline-flex; align-items:center; justify-content:center; gap:6px; transition:.15s; } .btn-primary { background:var(--accent); color:#fff; } .btn-primary:hover { background:#3d6ee8; transform:translateY(-1px); } .btn-secondary { background:var(--bg3); color:var(--text2); border:1px solid var(--border); } .btn-secondary:hover { color:var(--text); border-color:var(--border2); } .btn-danger { background:rgba(255,83,112,.15); color:var(--red); border:1px solid rgba(255,83,112,.3); } .btn-success { background:rgba(34,201,138,.15); color:var(--green); border:1px solid rgba(34,201,138,.3); } .btn-sm { padding:6px 14px; font-size:.8rem; } .btn-block { width:100%; }
.badge { display:inline-block; padding:3px 10px; border-radius:999px; font-size:.72rem; font-weight:600; letter-spacing:.04em; } .badge-green { background:rgba(34,201,138,.15); color:var(--green); } .badge-red { background:rgba(255,83,112,.15); color:var(--red); } .badge-blue { background:rgba(79,127,255,.15); color:var(--accent); } .badge-gray { background:rgba(139,146,168,.1); color:var(--text2); } .badge-yellow { background:rgba(255,184,48,.15); color:var(--yellow); } .badge-purple { background:rgba(124,92,252,.15); color:var(--accent2); }
.table-wrap { overflow-x:auto; } .data-table { width:100%; border-collapse:collapse; font-size:.85rem; } .data-table th { padding:12px; text-align:left; background:var(--bg); color:var(--text3); font-weight:600; border-bottom:1px solid var(--border); white-space:nowrap; } .data-table td { padding:12px; border-bottom:1px solid var(--border); color:var(--text); white-space:nowrap; vertical-align:middle; }
.clickable-cell { cursor:pointer; transition:background .15s; } .clickable-cell:hover { background:rgba(79,127,255,.08) !important; }
.room-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:16px; } .room-card { background:var(--bg3); border:1px solid var(--border); border-radius:var(--card-r); padding:18px; cursor:pointer; transition:transform .2s; } .room-card:hover { transform:translateY(-2px); box-shadow:0 4px 12px rgba(0,0,0,.2); } .room-card.vacant { opacity:.6; border-left:4px solid var(--text3); }
.filter-bar { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:20px; align-items:center; } .filter-select { background:var(--bg3); border:1px solid var(--border); color:var(--text2); border-radius:999px; padding:6px 14px; font-size:.82rem; outline:none; cursor:pointer; transition:var(--transition); } .filter-select:focus, .filter-select.active { border-color:var(--accent); color:var(--accent); background:rgba(79,127,255,.15); } .search-wrap { position:relative; width:220px; } .search-wrap input { width:100%; border-radius:999px; padding:6px 14px 6px 36px; background:var(--bg3); font-size:.85rem; border:1px solid var(--border); color:var(--text); } .search-wrap::before { content:'🔍'; position:absolute; left:12px; top:50%; transform:translateY(-50%); font-size:.85rem; pointer-events:none; }
.file-preview-list { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; } .file-item { display:inline-flex; align-items:center; gap:4px; background:var(--bg2); border:1px solid var(--border); padding:4px 8px; border-radius:6px; font-size:.75rem; color:var(--text2); }
.gemini-box { background:linear-gradient(135deg,rgba(124,92,252,.12),rgba(79,127,255,.12)); border:1px solid rgba(124,92,252,.3); border-radius:var(--card-r); padding:20px; } .gemini-header { display:flex; align-items:center; gap:10px; margin-bottom:12px; } .gemini-icon { width:28px; height:28px; border-radius:50%; background:linear-gradient(135deg,var(--accent2),var(--accent)); display:flex; align-items:center; justify-content:center; font-size:.85rem; } .gemini-label { font-weight:600; font-size:.88rem; color:var(--accent2); } .gemini-text { font-size:.88rem; line-height:1.7; color:var(--text2); }
.spinner-overlay { position:fixed; inset:0; z-index:9999; background:rgba(13,15,20,.8); display:none; align-items:center; justify-content:center; flex-direction:column; gap:12px; } .spinner-overlay.show { display:flex; } .spinner { width:40px; height:40px; border:3px solid var(--border2); border-top-color:var(--accent); border-radius:50%; animation:spin .8s linear infinite; } @keyframes spin { to { transform:rotate(360deg); } } .spinner-text { font-size:.88rem; color:var(--text2); }
.toast { position:fixed; bottom:24px; right:24px; z-index:10001; background:var(--bg3); border-left:4px solid var(--accent); border-radius:10px; padding:14px 20px; font-size:.88rem; box-shadow:0 8px 32px rgba(0,0,0,.4); transform:translateY(100px); opacity:0; transition:.3s; } .toast.show { transform:none; opacity:1; } .toast.success { border-left-color:var(--green); } .toast.error { border-left-color:var(--red); }
.empty-state { text-align:center; padding:48px 24px; color:var(--text3); font-size:.9rem; }
.flex { display:flex; } .flex-col { flex-direction:column; } .gap-8 { gap:8px; } .gap-12 { gap:12px; } .gap-16 { gap:16px; } .items-center { align-items:center; } .justify-between { justify-content:space-between; } .mt-16 { margin-top:16px; }
.truncate-name { display:inline; vertical-align:middle; }
@media(max-width:768px) { .truncate-name { display:inline-block; max-width:70px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } }
.pc-money { display:inline !important; } .mobile-money { display:none !important; font-family:var(--mono); font-weight:600; }
@media(max-width:768px) { .pc-money { display:none !important; } .mobile-money { display:inline !important; } }
@media(max-width:1200px) { .res-id { display:none!important; } }
@media(max-width:1000px) { .res-status, .res-date { display:none!important; } }
@media(max-width:900px) { .res-duration, .res-job { display:none!important; } }
@media(max-width:800px) { .res-pay { display:none!important; } }
@media(max-width:700px) { .res-demo { display:none!important; } }
.view-mode-label { background:var(--bg2); border:1px solid var(--border); color:var(--text); border-radius:8px; padding:10px 14px; font-size:.9rem; width:100%; min-height:42px; display:flex; align-items:center; }
.col-settings-wrap { position:relative; display:inline-flex; align-items:center; }
.col-settings-btn { background:transparent; border:1px solid var(--accent); color:var(--accent); border-radius:999px; padding:5px 12px; font-size:.8rem; cursor:pointer; font-family:inherit; transition:var(--transition); }
.col-settings-btn:hover { background:rgba(79,127,255,.12); }
.col-settings-panel { position:absolute; right:0; top:calc(100% + 6px); background:var(--bg3); border:1px solid var(--border2); border-radius:12px; padding:14px 16px; min-width:160px; z-index:600; box-shadow:0 8px 28px rgba(0,0,0,.5); display:none; }
.col-settings-panel.open { display:block; animation:fadeIn .15s ease; }
.col-settings-item { display:flex; align-items:center; gap:8px; padding:5px 0; font-size:.84rem; color:var(--text); cursor:pointer; border-bottom:1px dashed var(--border); }
.col-settings-item:last-child { border-bottom:none; }
.col-settings-item input[type=checkbox] { accent-color:var(--accent); width:14px; height:14px; flex-shrink:0; cursor:pointer; }
@media(max-width:768px) { .pc-money { display:none !important; } .mobile-money { display:inline !important; } }
.wish-badge { display:inline-flex; align-items:center; gap:6px; background:rgba(79,127,255,.15); border:1px solid var(--accent); color:var(--accent); border-radius:999px; padding:4px 12px; font-size:.82rem; font-weight:600; }
.wish-badge .wish-badge-x { cursor:pointer; color:var(--red); font-weight:700; margin-left:2px; }
.wish-badge-wrap { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; min-height:32px; }
.deposit-settle-row { 
  display: flex; 
  justify-content: space-between; 
  align-items: center; 
  padding: 8px 0; 
  border-bottom: 1px dashed var(--border); 
  font-size: .88rem; 
}
.deposit-settle-total { 
  font-size: 1.1rem; 
  font-weight: 700; 
  color: var(--green); 
  padding-top: 10px; 
}
</style>
</head>
<body>
<div class="app-wrap">
  <header class="header">
    <div class="header-logo">🏢 더 스테이 스마트 관리</div>
    <div class="header-month">
      <button class="btn-month-nav" onclick="openSettingsModal()" title="마스터 설정">⚙️</button>
      <button class="btn-month-nav" onclick="changeMonth(-1)">◀</button>
      <input type="month" id="globalMonth" class="month-input" />
      <button class="btn-month-nav" onclick="changeMonth(1)">▶</button>
    </div>
  </header>
  <nav class="tab-nav">
    <button class="tab-btn active" data-tab="dashboard">대시보드</button>
    <button class="tab-btn" data-tab="rooms">통합 수납 현황</button>
    <button class="tab-btn" data-tab="tenants">입주자 관리</button>
    <button class="tab-btn" data-tab="expense">입/출금 관리</button>
    <button class="tab-btn" data-tab="room-manage">호실 관리</button>
  </nav>
  <main class="main">
    <!-- 대시보드 -->
    <section class="tab-panel active" id="tab-dashboard">
      <div class="flex gap-8" style="margin-bottom:16px;">
        <button class="btn btn-primary btn-sm" id="btnDashFin" onclick="switchDash('fin')">재무 현황</button>
        <button class="btn btn-secondary btn-sm" id="btnDashTen" onclick="switchDash('ten')">입주자 통계</button>
      </div>
      <div id="dash-fin-view">
        <div id="transferAlertBox" style="display:none;"></div>
        <div id="dash-schedule-box" style="margin-bottom:16px; display:none;"></div>
        <div class="grid-4" style="margin-bottom:16px;">
          <div class="stat-card card">
            <div class="stat-label">총 매출(수익)</div>
            <div class="stat-val green" id="s-revenue">—</div>
            <div class="stat-sub">수납 및 부가수익 포함</div>
            </div>
          <div class="stat-card card">
            <div class="stat-label">총 지출</div>
            <div class="stat-val red" id="s-expense">—</div>
            <div class="stat-sub">이달 지출 합계</div>
            </div>
          <div class="stat-card card">
            <div class="stat-label">순수익</div>
            <div class="stat-val blue" id="s-profit">—</div>
            <div class="stat-sub">매출 - 지출</div>
          </div>
          <div class="stat-card card">
            <div class="stat-label">호실 현황</div>
            <div class="stat-val purple" id="s-rooms">—</div>
            <div class="stat-sub" id="s-rooms-sub">—</div>
          </div>
          <div class="stat-card card">
            <div class="stat-label">보유 보증금</div>
            <div class="stat-val yellow" id="s-deposit">—</div>
            <div class="stat-sub">현재 보유 중인 총 보증금</div>
          </div>
        </div>
        <div class="grid-2" style="margin-bottom:16px;">
          <div class="card"><div class="card-title">월별 매출·지출·순수익 추이</div><div style="position:relative;height:220px;"><canvas id="trendChart"></canvas></div></div>
          <div class="card"><div class="card-title">지출 카테고리 비중</div><div style="position:relative;height:220px;"><canvas id="catChart"></canvas></div></div>
        </div>
        <div class="gemini-box">
          <div class="gemini-header"><div class="gemini-icon">✨</div><div class="gemini-label">Gemini AI 재무 분석</div><button class="btn btn-secondary btn-sm" onclick="refreshGemini()">새로 분석</button></div>
          <div class="gemini-text" id="geminiText">대시보드를 불러오면 AI 분석이 표시됩니다.</div>
        </div>
      </div>
      <div id="dash-ten-view" style="display:none;">
        <div class="grid-2" style="margin-bottom:16px;">
          <div class="stat-card"><div class="stat-label">현재 입주자 수</div><div class="stat-val blue" id="s-tenant-total">—</div></div>
          <div class="stat-card"><div class="stat-label">외국인 입주자 비율</div><div class="stat-val purple" id="s-tenant-foreign">—</div></div>
        </div>
        <div class="grid-3">
          <div class="card"><div class="card-title">직업 분포</div><div style="position:relative;height:220px;"><canvas id="jobChart"></canvas></div></div>
          <div class="card"><div class="card-title">성별 비율</div><div style="position:relative;height:220px;"><canvas id="genderChart"></canvas></div></div>
          <div class="card"><div class="card-title">국적 분포</div><div style="position:relative;height:220px;"><canvas id="natChart"></canvas></div></div>
        </div>
      </div>
    </section>

    <!-- 통합 수납 현황 -->
    <section class="tab-panel" id="tab-rooms">
      <div class="flex items-center justify-between" style="margin-bottom:20px;">
        <h2 class="section-title" style="margin-bottom:0;">통합 수납 현황</h2>
        <button class="btn btn-primary btn-sm" onclick="loadAll()">새로고침</button>
      </div>
      <div class="filter-bar" id="roomStatusFilter">
        <select id="rsf-floor" class="filter-select"><option value="all">층수 (전체)</option><option value="4">4층</option><option value="5">5층</option></select>
        <select id="rsf-status" class="filter-select"><option value="all">수납 상태 (전체)</option><option value="paid">완납</option><option value="unpaid">미수납</option><option value="vacant">공실</option></select>
        <button class="btn btn-secondary btn-sm" style="border-radius:999px;" onclick="resetRoomStatusFilters()">초기화</button>
        <div class="col-settings-wrap" style="margin-left:auto;"><button class="col-settings-btn" onclick="toggleColSettings('roomStatusTable')">⚙️ 열 설정</button><div class="col-settings-panel" id="colPanel-roomStatusTable"></div></div>
      </div>
      <div class="card" style="padding:0;">
        <div class="table-wrap">
          <table class="data-table" id="roomStatusTable">
            <thead>
              <tr>
                <th data-col="호실" onclick="sortRoomGrid('호실')" style="cursor:pointer; width:70px;">호실 <span id="sort-호실"></span></th>
                <th data-col="타입" onclick="sortRoomGrid('방타입')" style="cursor:pointer;" class="res-job">타입 <span id="sort-방타입"></span></th>
                <th data-col="창문" onclick="sortRoomGrid('창문')" style="cursor:pointer;" class="res-job">창문 <span id="sort-창문"></span></th>
                <th data-col="입주자" onclick="sortRoomGrid('이름')" style="cursor:pointer;">입주자 <span id="sort-이름"></span></th>
                <th data-col="연락처" class="res-demo">연락처</th>
                <th data-col="보증금">보증금</th>
                <th data-col="이용료" onclick="sortRoomGrid('예정금액')" style="cursor:pointer;">이용료 <span id="sort-예정금액"></span></th>
                <th data-col="총수납액" onclick="sortRoomGrid('총수납액')" style="cursor:pointer;" class="res-job">총 수납액 <span id="sort-총수납액"></span></th>
                <th data-col="잔액" onclick="sortRoomGrid('잔액')" style="cursor:pointer;">잔액 <span id="sort-잔액"></span></th>
                <th data-col="상태" onclick="sortRoomGrid('상태')" style="cursor:pointer;">상태 <span id="sort-상태"></span></th>
              </tr>
            </thead>
            <tbody id="roomGrid"><tr><td colspan="10" class="empty-state">데이터를 불러오는 중입니다…</td></tr></tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- 입주자 관리 -->
    <section class="tab-panel" id="tab-tenants">
      <div class="sub-nav">
        <button class="sub-btn active" id="btn-ten-active" onclick="switchTenTab('active')">거주 및 예약</button>
        <button class="sub-btn" id="btn-ten-past" onclick="switchTenTab('past')">퇴실/과거 기록</button>
      </div>
      <div class="flex items-center justify-between" style="margin-bottom:16px;">
        <div class="flex items-center gap-8"><h2 class="section-title" id="tenantTitle" style="margin-bottom:0;">거주 및 예약자 목록</h2><button class="btn btn-secondary btn-sm" onclick="loadAll()">새로고침</button></div>
        <button class="btn btn-primary btn-sm" id="btn-add-tenant" onclick="openTenantModal('','edit')">입주자 추가</button>
      </div>
      <div class="filter-bar" style="margin-bottom:16px;">
        <div class="search-wrap"><input type="text" id="tenantSearch" placeholder="이름·호실·연락처…" oninput="filterTenants()" /></div>
        <select id="tf-status" class="filter-select" onchange="filterTenants()"><option value="all">상태 (전체)</option><option value="거주중">거주중</option><option value="입실 예정">입실 예정</option><option value="퇴실 예정">퇴실 예정</option></select>
        <select id="tf-gender" class="filter-select" onchange="filterTenants()"><option value="all">성별 (전체)</option><option value="남성">남성</option><option value="여성">여성</option><option value="미상">미상</option></select>
        <select id="tf-job" class="filter-select" onchange="filterTenants()"><option value="all">직업 (전체)</option></select>
        <select id="tf-pay" class="filter-select" onchange="filterTenants()"><option value="all">결제수단 (전체)</option><option value="계좌이체">계좌이체</option><option value="신용카드">신용카드</option><option value="현금">현금</option></select>
        <button class="btn btn-secondary btn-sm" style="border-radius:999px;" onclick="resetTenantFilters()">초기화</button>
        <div class="col-settings-wrap" style="margin-left:auto;"><button class="col-settings-btn" onclick="toggleColSettings('tenantTable')">⚙️ 열 설정</button><div class="col-settings-panel" id="colPanel-tenantTable"></div></div>
      </div>
      <div class="card" style="padding:0;">
        <div class="table-wrap">
          <table class="data-table" id="tenantTable">
            <thead>
              <tr>
                <th data-col="ID" class="res-id" onclick="sortTenantGrid('ID')" style="cursor:pointer;">ID <span id="sort-t-ID"></span></th>
                <th data-col="호실" onclick="sortTenantGrid('호실')" style="cursor:pointer;">호실 <span id="sort-t-호실"></span></th>
                <th data-col="이름" onclick="sortTenantGrid('이름')" style="cursor:pointer;">이름 <span id="sort-t-이름"></span></th>
                <th data-col="국적" class="res-demo" onclick="sortTenantGrid('국적')" style="cursor:pointer;">국적 <span id="sort-t-국적"></span></th>
                <th data-col="성별" class="res-demo" onclick="sortTenantGrid('성별')" style="cursor:pointer;">성별 <span id="sort-t-성별"></span></th>
                <th data-col="직업" class="res-job" onclick="sortTenantGrid('직업')" style="cursor:pointer;">직업 <span id="sort-t-직업"></span></th>
                <th data-col="연락처">연락처</th>
                <th data-col="결제수단" class="res-pay" onclick="sortTenantGrid('결제수단')" style="cursor:pointer;">결제수단 <span id="sort-t-결제수단"></span></th>
                <th data-col="보증금" onclick="sortTenantGrid('보증금')" style="cursor:pointer;">보증금 <span id="sort-t-보증금"></span></th>
                <th data-col="이용료" onclick="sortTenantGrid('금액')" style="cursor:pointer;">이용료 <span id="sort-t-금액"></span></th>
                <th data-col="수납일" onclick="sortTenantGrid('수납일')" style="cursor:pointer;">수납일 <span id="sort-t-수납일"></span></th>
                <th data-col="거주기간" class="res-duration" onclick="sortTenantGrid('거주기간')" style="cursor:pointer;">거주기간 <span id="sort-t-거주기간"></span></th>
                <th data-col="상태" class="res-status" onclick="sortTenantGrid('상태')" style="cursor:pointer;">상태 <span id="sort-t-상태"></span></th>
                <th data-col="예정일" class="res-date" onclick="sortTenantGrid('예정일')" style="cursor:pointer;">예정일 <span id="sort-t-예정일"></span></th>
              </tr>
            </thead>
            <tbody id="tenantBody"><tr><td colspan="14" class="empty-state">데이터를 불러오는 중입니다…</td></tr></tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- 입/출금 관리 -->
    <section class="tab-panel" id="tab-expense">
      <div class="sub-nav">
        <button class="sub-btn active" id="btn-exp-input" onclick="switchExpTab('input')">지출 내역</button>
        <button class="sub-btn" id="btn-exp-income" onclick="switchExpTab('income')">부가 수익 관리</button>
        <button class="sub-btn" id="btn-exp-settle" onclick="switchExpTab('settle')">카드 대금 정산</button>
        <button class="sub-btn" id="btn-exp-manage" onclick="switchExpTab('manage')">자산 등록 및 수정</button>
      </div>
      <div id="exp-view-input">
        <div class="flex items-center justify-between" style="margin-bottom:16px;"><div class="flex items-center gap-8"><h2 class="section-title" style="margin-bottom:0;">지출 내역 목록</h2><button class="btn btn-secondary btn-sm" onclick="loadAll()">새로고침</button></div><button class="btn btn-primary btn-sm" onclick="openExpenseModal('')">지출 내역 추가</button></div>
        <div class="filter-bar" style="margin-bottom:16px;">
          <select id="ef-method" class="filter-select" onchange="filterExpenses()"><option value="all">결제수단 (전체)</option><option value="계좌이체">계좌이체</option><option value="신용카드">신용카드</option><option value="체크카드">체크카드</option><option value="현금/기타">현금/기타</option></select>
          <select id="ef-finance" class="filter-select" onchange="filterExpenses()"><option value="all">금융사 (전체)</option></select>
          <select id="ef-category" class="filter-select" onchange="filterExpenses()"><option value="all">카테고리 (전체)</option></select>
          <button class="btn btn-secondary btn-sm" style="border-radius:999px;" onclick="resetExpenseFilters()">초기화</button>
          <div style="margin-left:auto; font-weight:700; color:var(--red); font-size:1.15rem; font-family:var(--mono);" id="expenseTotalAmount">합계: 0원</div>
          <div class="col-settings-wrap"><button class="col-settings-btn" onclick="toggleColSettings('expenseTable')">⚙️ 열 설정</button><div class="col-settings-panel" id="colPanel-expenseTable"></div></div>
        </div>
        <div class="card" style="padding:0;"><div class="table-wrap"><table class="data-table" id="expenseTable"><thead><tr><th data-col="날짜" onclick="sortExpenseGrid('날짜')" style="cursor:pointer;">날짜 <span id="sort-e-날짜"></span></th><th data-col="결제수단" onclick="sortExpenseGrid('결제수단')" style="cursor:pointer;">결제수단 <span id="sort-e-결제수단"></span></th><th data-col="항목" onclick="sortExpenseGrid('항목')" style="cursor:pointer;">항목 <span id="sort-e-항목"></span></th><th data-col="금액" onclick="sortExpenseGrid('금액')" style="cursor:pointer;">금액 <span id="sort-e-금액"></span></th><th data-col="상태">상태</th><th data-col="액션">액션</th></tr></thead><tbody id="expenseBody"></tbody></table></div></div>
      </div>
      <div id="exp-view-income" style="display:none;">
        <div class="flex items-center justify-between" style="margin-bottom:16px;"><div class="flex items-center gap-8"><h2 class="section-title" style="margin-bottom:0;">부가 수익 목록</h2><button class="btn btn-secondary btn-sm" onclick="loadAll()">새로고침</button></div><button class="btn btn-success btn-sm" onclick="openIncomeModal('')">부가 수익 추가</button></div>
        <div class="filter-bar" style="margin-bottom:16px;">
          <select id="if-method" class="filter-select" onchange="filterIncomes()"><option value="all">입금수단 (전체)</option><option value="계좌이체">계좌이체</option><option value="신용카드">신용카드</option><option value="현금/기타">현금/기타</option></select>
          <select id="if-finance" class="filter-select" onchange="filterIncomes()"><option value="all">금융사 (전체)</option></select>
          <select id="if-category" class="filter-select" onchange="filterIncomes()"><option value="all">카테고리 (전체)</option></select>
          <button class="btn btn-secondary btn-sm" style="border-radius:999px;" onclick="resetIncomeFilters()">초기화</button>
          <div style="margin-left:auto; font-weight:700; color:var(--green); font-size:1.15rem; font-family:var(--mono);" id="incomeTotalAmount">합계: 0원</div>
          <div class="col-settings-wrap"><button class="col-settings-btn" onclick="toggleColSettings('incomeTable')">⚙️ 열 설정</button><div class="col-settings-panel" id="colPanel-incomeTable"></div></div>
        </div>
        <div class="card" style="padding:0;"><div class="table-wrap"><table class="data-table" id="incomeTable"><thead><tr><th data-col="날짜" onclick="sortIncomeGrid('날짜')" style="cursor:pointer;">날짜 <span id="sort-i-날짜"></span></th><th data-col="입금수단" onclick="sortIncomeGrid('수단')" style="cursor:pointer;">입금수단 <span id="sort-i-수단"></span></th><th data-col="항목" onclick="sortIncomeGrid('항목')" style="cursor:pointer;">항목 <span id="sort-i-항목"></span></th><th data-col="금액" onclick="sortIncomeGrid('금액')" style="cursor:pointer;">금액 <span id="sort-i-금액"></span></th><th data-col="액션">액션</th></tr></thead><tbody id="incomeBody"></tbody></table></div></div>
      </div>
      <div id="exp-view-settle" style="display:none;"><div class="card" style="padding:24px;"><div class="section-title" style="margin-bottom:20px;">미정산 신용카드 대금 합산</div><div id="settleGrid" class="grid-3"><div class="empty-state" style="grid-column:1/-1;">데이터 동기화를 진행해주세요.</div></div></div></div>
      <div id="exp-view-manage" style="display:none;" class="grid-2">
        <div class="card"><div class="section-title">자산 등록 및 수정</div><div class="flex flex-col gap-12"><input type="hidden" id="f-id" /><div class="grid-2"><div class="form-group"><label class="form-label">분류</label><select id="f-type" class="form-select" onchange="handleFinanceType()"><option value="은행계좌">은행계좌</option><option value="신용카드">신용카드</option><option value="체크카드">체크카드</option></select></div><div class="form-group"><label class="form-label">금융사명</label><select id="f-brand" class="form-select"></select></div></div><div class="grid-2"><div class="form-group"><label class="form-label">별칭</label><input type="text" id="f-alias" class="form-input" placeholder="별칭" /></div><div class="form-group"><label class="form-label">번호(끝 4자리 등)</label><input type="text" id="f-number" class="form-input" /></div></div><div class="grid-2"><div class="form-group"><label class="form-label">소유주명</label><input type="text" id="f-owner" class="form-input" placeholder="소유주" /></div><div class="form-group" id="f-payday-wrap" style="display:none;"><label class="form-label">결제일</label><input type="text" id="f-payday" class="form-input" placeholder="일/말일" /></div></div><div class="form-group" id="f-cutoff-wrap" style="display:none;"><label class="form-label">이용종료일</label><input type="text" id="f-cutoff" class="form-input" placeholder="신용카드 기준일" /></div><div class="form-group" id="f-linked-wrap" style="display:none;"><label class="form-label">결제 연결 계좌</label><select id="f-linked-account" class="form-select"><option value="">선택 안함</option></select></div><div class="flex gap-8 mt-16"><button class="btn btn-secondary" onclick="clearFinanceForm()">초기화</button><button class="btn btn-primary flex-1" onclick="saveFinance()">저장</button></div></div></div>
        <div class="card" style="padding:0;"><div style="padding:20px 20px 0;"><div class="section-title">등록된 자산 목록</div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>구분</th><th>금융사</th><th>별칭/번호</th><th>소유주</th><th>결제일(출금)</th><th>관리</th></tr></thead><tbody id="financeBody"><tr><td colspan="6" class="empty-state">등록된 자산이 없습니다.</td></tr></tbody></table></div></div>
      </div>
    </section>

    <!-- 호실 관리 -->
    <section class="tab-panel" id="tab-room-manage">
      <div class="flex items-center justify-between" style="margin-bottom:20px;"><h2 class="section-title" style="margin-bottom:0;">호실 컨디션 관리</h2><button class="btn btn-primary btn-sm" onclick="loadAll()">새로고침</button></div>
      <div class="filter-bar" id="manageRoomFilter">
        <select id="rmf-floor" class="filter-select"><option value="all">층수 (전체)</option><option value="4">4층</option><option value="5">5층</option></select>
        <select id="rmf-status" class="filter-select"><option value="all">상태 (전체)</option><option value="occupied">입주중</option><option value="vacant">공실</option></select>
        <select id="rmf-type" class="filter-select"><option value="all">방 타입 (전체)</option><option value="원룸">원룸</option><option value="미니룸">미니룸</option></select>
        <button class="btn btn-secondary btn-sm" style="border-radius:999px;" onclick="resetRoomManageFilters()">초기화</button>
      </div>
      <div class="room-grid" id="roomManageGrid"><div class="empty-state" style="grid-column:1/-1;">데이터를 불러오는 중입니다…</div></div>
    </section>
  </main>
</div>

<!-- 마스터 설정 모달 -->
<div id="settingsModal" style="display:none;position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,.7);backdrop-filter:blur(4px);overflow-y:auto;">
  <div style="background:var(--bg3);border-radius:18px;max-width:500px;margin:40px auto;padding:32px;border:1px solid var(--border2);">
    <div class="flex justify-between items-center" style="margin-bottom:20px;"><h3 style="font-weight:700;font-size:1.1rem;">마스터 데이터 관리</h3><button onclick="closeSettingsModal()" style="background:none;color:var(--text2);font-size:1.3rem;">✕</button></div>
    <div class="sub-nav" style="margin-bottom:20px;">
      <button class="sub-btn active" id="set-btn-job" onclick="switchSetTab('job')">직업 목록</button>
      <button class="sub-btn" id="set-btn-cat" onclick="switchSetTab('cat')">카테고리</button>
      <button class="sub-btn" id="set-btn-route" onclick="switchSetTab('route')">방문 경로</button>
      </div>
    <div id="set-tab-job" class="flex flex-col gap-12"><div style="font-size:0.85rem;color:var(--text2);">등록된 직업 목록입니다.</div><div id="set-job-list" class="flex flex-col gap-8" style="max-height:350px;overflow-y:auto;border:1px solid var(--border);padding:10px;border-radius:8px;"></div></div>
    <div id="set-tab-cat" style="display:none;flex-direction:column;gap:12px;"><div style="font-size:0.85rem;color:var(--text2);">등록된 카테고리입니다.</div><div id="set-cat-list" class="flex flex-col gap-8" style="max-height:350px;overflow-y:auto;border:1px solid var(--border);padding:10px;border-radius:8px;"></div></div>
    <div id="set-tab-route" style="display:none;flex-direction:column;gap:12px;">
        <div style="font-size:0.85rem;color:var(--text2);">추가된 방문 경로 목록입니다.</div>
        <div id="set-route-list" class="flex flex-col gap-8" style="max-height:350px;overflow-y:auto;border:1px solid var(--border);padding:10px;border-radius:8px;"></div>
      </div>
  </div>
</div>

<!-- 입주자 모달 -->
<div id="tenantModal" style="display:none;position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,.7);backdrop-filter:blur(4px);overflow-y:auto;">
  <div style="background:var(--bg3);border-radius:18px;max-width:720px;margin:40px auto;padding:32px;border:1px solid var(--border2);">
    <div class="flex justify-between items-center" style="margin-bottom:20px;"><h3 id="modalTitle" style="font-weight:700;font-size:1.1rem;">입주자 정보</h3><button onclick="closeTenantModal()" style="background:none;color:var(--text2);font-size:1.3rem;">✕</button></div>
    <input type="hidden" id="m-id" />
    <div class="sub-nav" style="margin-bottom:24px;"><button class="sub-btn active" id="m-tab-btn-basic" onclick="switchModalTab('basic')">기본 정보</button><button class="sub-btn" id="m-tab-btn-history" onclick="switchModalTab('history')">분석</button></div>
    
    <div id="m-tab-basic" class="flex flex-col gap-12">
      
      <div class="grid-2">
        <div class="form-group"><label class="form-label">이름 *</label><input id="m-name" class="form-input" placeholder="실명 입력"/></div>
        <div class="form-group"><label class="form-label">영어이름 (선택)</label><input id="m-eng-name" class="form-input" placeholder="예: John Doe"/></div>
      </div>
      
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">연락 수단 / 연락처 *</label>
          <div style="display:flex;gap:8px;">
            <select id="m-contact-type" class="form-select" style="width:140px;" onchange="handleContactTypeChange()">
              <option value="휴대전화">📞 휴대전화</option><option value="카카오톡">💛 카카오톡</option><option value="라인">💚 라인</option><option value="위챗">💚 위챗</option><option value="텔레그램">✈️ 텔레그램</option><option value="페이스북 메신저">💙 페이스북 메신저</option><option value="스냅챗">👻 스냅챗</option><option value="미정">⏳ 미정</option>
            </select>
            <input id="m-phone" class="form-input" style="flex:1;" placeholder="연락처"/>
          </div>
        </div>
        <div class="form-group"><label class="form-label">생년월일</label><input type="date" id="m-birthdate" class="form-input"/></div>
      </div>

      <div class="grid-2">
        <div class="form-group"><label class="form-label">비상연락처 관계</label><input id="m-emerg-relation" class="form-input" placeholder="예: 부, 모, 배우자"/></div>
        <div class="form-group"><label class="form-label">비상연락처</label><input id="m-emerg-phone" class="form-input" placeholder="010-0000-0000"/></div>
      </div>

      <div class="grid-3">
        <div class="form-group"><label class="form-label">국적</label><select id="m-nationality" class="form-select"><option value="🇰🇷 대한민국">🇰🇷 대한민국</option></select></div>
        <div class="form-group"><label class="form-label">성별</label><select id="m-gender" class="form-select"><option value="남성">남성</option><option value="여성">여성</option><option value="미상">미상</option></select></div>
        <div class="form-group">
          <label class="form-label">직업</label>
          <select id="m-job" class="form-select" onchange="handleJobChange()">
            <option value="미정">미정</option><option value="학생">학생</option><option value="직장인">직장인</option><option value="전문직">전문직</option><option value="자영업">자영업</option><option value="배달">배달</option><option value="건설노동자">건설노동자</option><option value="무직">무직</option><option value="기초생활수급자">기초생활수급자</option><option value="추가">+ 직접 입력</option>
          </select>
          <input type="text" id="m-job-custom" class="form-input" style="display:none;margin-top:6px;" placeholder="직업 직접 입력" />
        </div>
      </div>

      <div class="grid-2">
        <div class="form-group"><label class="form-label">호실 *</label><select id="m-room" class="form-select" onchange="handleRoomSelectInTenant()"></select></div>
        <div class="form-group"><label class="form-label">상태</label>
          <select id="m-status" class="form-select" onchange="handleTenantStatusChange()">
            <option value="투어 대기">투어 대기</option><option value="투어 완료">투어 완료</option><option value="입주 대기">입주 대기</option><option value="거주중">거주중</option><option value="퇴실 예정">퇴실 예정</option><option value="퇴실 완료">퇴실 완료</option><option value="패스/취소">패스/취소</option>
          </select>
        </div>
      </div>

      <div id="m-tour-date-fields" style="display:none;">
        <div class="grid-2">
          <div class="form-group"><label class="form-label">투어 희망일</label><input type="datetime-local" id="m-tour-date" class="form-input"/></div>
          <div class="form-group"><label class="form-label">입주 희망일</label><input type="date" id="m-move-hope-date" class="form-input"/></div>
        </div>
      </div>

      <div id="m-tour-fields" style="display:none;" class="flex flex-col gap-12">
        <div class="form-group"><label class="form-label">방문 경로</label>
          <select id="m-visit-route" class="form-select" onchange="handleVisitRouteChange()">
            <option value="">선택</option><option value="네이버지도">네이버지도</option><option value="카카오맵">카카오맵</option><option value="고방">고방</option><option value="블로그">블로그</option><option value="지인추천">지인추천</option><option value="직접방문">직접방문</option><option value="추가">+ 추가</option>
          </select>
          <input type="text" id="m-visit-route-custom" class="form-input" style="display:none;margin-top:6px;" placeholder="방문 경로 직접 입력" />
        </div>
      </div>

      <div id="m-contract-fields" class="flex flex-col gap-12">
        <div class="grid-2">
          <div class="form-group"><label class="form-label">입주일</label><input type="date" id="m-movein" class="form-input"/></div>
          <div class="form-group" id="m-moveout-wrap" style="display:none;"><label class="form-label">퇴실 예정일</label><input type="date" id="m-moveout" class="form-input"/></div>
        </div>
        <div class="grid-3">
          <div class="form-group"><label class="form-label">선후납</label><select id="m-payment-type" class="form-select"><option value="선납">선납</option><option value="후납">후납</option></select></div>
          <div class="form-group"><label class="form-label">보증금 여부</label><select id="m-deposit-yn" class="form-select" onchange="toggleDeposit()"><option value="N">없음</option><option value="Y">있음</option></select></div>
          <div class="form-group" id="m-deposit-wrap" style="display:none;"><label class="form-label">보증금 금액</label><input id="m-deposit" class="form-input" oninput="formatMoneyInput(event)"/></div>
        </div>
        <div class="form-group" id="m-cleaning-wrap" style="display:none;"><label class="form-label">청소비 (퇴실 공제)</label><input id="m-cleaning-fee" class="form-input" oninput="formatMoneyInput(event)" placeholder="예: 30,000원" style="max-width:200px;"/></div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">수납일 <span style="color:var(--text3);font-weight:400;">(숫자 입력 → 자동으로 "일" 추가)</span></label>
            <input id="m-due-day" class="form-input" placeholder="예: 25 또는 말일"/>
          </div>
          <div class="form-group">
            <label class="form-label">이용료 <span id="m-room-rent-hint" style="color:var(--text3);font-weight:400;font-size:0.75rem;"></span></label>
            <input id="m-due-amount" class="form-input" oninput="formatMoneyInput(event)" placeholder="비워두면 호실 기본이용료 자동 적용"/>
          </div>
        </div>
        <div class="grid-3">
          <div class="form-group"><label class="form-label">결제수단</label><select id="m-pay-method" class="form-select"><option value="계좌이체">계좌이체</option><option value="신용카드">신용카드</option><option value="현금">현금</option></select></div>
          <div class="form-group"><label class="form-label">현금영수증</label><select id="m-cash-receipt" class="form-select"><option value="불필요">불필요</option><option value="필요 (소득공제)">소득공제</option><option value="필요 (지출증빙)">지출증빙</option></select></div>
          <div class="form-group"><label class="form-label">전입신고</label><select id="m-movein-report" class="form-select"><option value="미신고">미신고</option><option value="완료">완료</option><option value="해당없음">해당없음</option></select></div>
        </div>
        <div class="form-group"><label class="form-label">계약서 업로드</label><input type="file" id="m-contract-file" class="form-input" multiple onchange="previewContract(event)"/><div id="m-contract-preview" class="file-preview-list"></div></div>
      </div> <div class="form-group">
        <label class="form-label">입실 희망 호실 <span style="color:var(--text3);font-size:.75rem;">(최대 5개 · 공실/퇴실 예정 시 대시보드 알림)</span></label>
        <div class="flex gap-8" style="margin-bottom:8px;flex-wrap:wrap;">
          <select id="m-wish-floor" class="form-select" style="width:110px;" onchange="refreshWishRoomDropdown()"><option value="all">층수 전체</option><option value="4">4층</option><option value="5">5층</option></select>
          <select id="m-wish-wintype" class="form-select" style="width:120px;" onchange="refreshWishRoomDropdown()"><option value="all">창문 전체</option><option value="외창">외창</option><option value="내창">내창</option></select>
          <select id="m-wish-roomtype" class="form-select" style="width:120px;" onchange="refreshWishRoomDropdown()"><option value="all">타입 전체</option><option value="원룸">원룸</option><option value="미니룸">미니룸</option></select>
          <select id="m-wish-direction" class="form-select" style="width:120px;" onchange="refreshWishRoomDropdown()"><option value="all">방향 전체</option><option value="남향">남향</option><option value="동향">동향</option><option value="서향">서향</option><option value="북향">북향</option><option value="남동향">남동향</option><option value="남서향">남서향</option><option value="북동향">북동향</option><option value="북서향">북서향</option></select>
        </div>
        <select id="m-wish-select" class="form-select" onchange="addWishRoom(this.value); this.value='';"><option value="">호실 선택...</option></select>
        <div class="wish-badge-wrap" id="m-wish-badges"></div>
        <input type="hidden" id="m-wish-rooms" />
      </div>

      <div class="form-group"><label class="form-label">메모</label><textarea id="m-memo" class="form-textarea"></textarea></div>
      <div class="form-group"><label class="form-label">기초수급자</label><select id="m-basic-recipient" class="form-select"><option value="N">아니오</option><option value="Y">예 (대상자)</option></select></div>
    </div>
    
    <div id="m-tab-history" style="display:none;flex-direction:column;gap:16px;">
      <div class="card" style="padding:16px;"><div class="card-title">수납 기록</div><div id="m-history-list" class="gap-8 flex flex-col" style="font-size:0.85rem;color:var(--text2);"></div></div>
      <div class="card" style="padding:16px;"><div class="card-title">수납 건전성</div><div id="m-payment-health" class="flex flex-wrap gap-8"></div></div>
      <div class="gemini-box mt-16"><div class="gemini-header"><div class="gemini-icon">✨</div><div class="gemini-label">AI 입주자 진단</div></div><div class="gemini-text" id="m-gemini-tenant-text">입주자 데이터를 분석 중입니다...</div></div>
    </div>
    
    <div class="flex justify-between mt-16" style="width:100%;border-top:1px solid var(--border);padding-top:20px;">
      <div class="flex gap-8">
        <button id="m-delete-btn" class="btn btn-danger" onclick="executeDeleteTenant()" style="display:none;">삭제</button>
        <button id="m-checkout-btn" class="btn btn-danger" onclick="executeCheckout()" style="display:none;">퇴실</button>
        <button id="m-deposit-settle-btn" class="btn btn-secondary" onclick="openDepositSettleModal()" style="display:none;">💰 보증금 정산</button>
      </div>
      <div class="flex gap-8">
        <button class="btn btn-secondary" onclick="closeTenantModal()">닫기</button>
        <button id="m-go-edit-btn" class="btn btn-secondary" style="display:none;border-color:var(--accent);color:var(--accent);" onclick="switchTenantModalToEdit()">수정하기</button>
        <button id="m-save-btn" class="btn btn-primary" onclick="saveTenant()" style="display:none;">저장</button>
      </div>
    </div>
  </div>
</div>

<!-- 호실 정보 수정 모달 -->
<div id="roomManageModal" style="display:none;position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,.7);backdrop-filter:blur(4px);overflow-y:auto;">
  <div style="background:var(--bg3);border:1px solid var(--border2);border-radius:18px;max-width:550px;margin:40px auto;padding:32px;">
    <div class="flex items-center justify-between" style="margin-bottom:24px;"><h3 style="font-size:1.1rem;font-weight:700;">호실 정보 수정</h3><button onclick="closeRoomManageModal()" style="background:none;color:var(--text2);font-size:1.3rem;">✕</button></div>
    <div class="flex flex-col gap-12">
      <div class="grid-2"><div class="form-group"><label class="form-label">호실</label><input type="text" class="form-input" id="rm-no" readonly style="background:var(--bg2);" /></div><div class="form-group"><label class="form-label">기본 이용료</label><input type="text" class="form-input" id="rm-rent" oninput="formatMoneyInput(event)" /></div></div>
      <div class="form-group"><label class="form-label">방 타입</label><select class="form-select" id="rm-type"><option value="">선택 안함</option><option value="미니룸">미니룸</option><option value="원룸">원룸</option><option value="기타">기타</option></select></div>
      <div class="grid-2">
      <div class="form-group"><label class="form-label">창문 타입</label><select class="form-select" id="rm-window">
        <option value="">선택</option>
        <option value="외창">외창</option>
        <option value="내창">내창</option>
      </select></div><div class="form-group"><label class="form-label">방향</label><select class="form-select" id="rm-direction"><option value="">선택</option><option value="남향">남향</option><option value="동향">동향</option><option value="서향">서향</option><option value="북향">북향</option><option value="남동향">남동향</option><option value="남서향">남서향</option><option value="북동향">북동향</option><option value="북서향">북서향</option></select></div></div>
      <div class="grid-2"><div class="form-group"><label class="form-label">면적 (평)</label><input type="number" class="form-input" id="rm-area-py" step="0.1" oninput="convertArea('py')" placeholder="평수 입력" /></div><div class="form-group"><label class="form-label">면적 (m²)</label><input type="number" class="form-input" id="rm-area-m2" step="0.1" oninput="convertArea('m2')" placeholder="제곱미터 입력" /></div></div>
      <div class="form-group"><label class="form-label">메모</label><textarea class="form-textarea" id="rm-memo"></textarea></div>
      <div class="form-group"><label class="form-label">사진 업로드</label><input type="file" id="rm-photos" multiple accept="image/*" class="form-input" onchange="previewPhotos(event)" /><div id="rm-photo-preview" style="display:flex;flex-direction:column;gap:6px;margin-top:8px;"></div></div><input type="hidden" id="rm-existing-photos" /></div>
      <div class="flex gap-8 mt-16" style="justify-content:flex-end;"><button class="btn btn-secondary" onclick="closeRoomManageModal()">닫기</button><button class="btn btn-primary" onclick="saveRoomManage()">저장</button></div>
    </div>
  </div>
</div>

<!-- 지출 모달 -->
<div id="expenseModal" style="display:none;position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,.7);backdrop-filter:blur(4px);overflow-y:auto;"><div style="background:var(--bg3);border-radius:18px;max-width:640px;margin:40px auto;padding:32px;border:1px solid var(--border2);"><div class="flex justify-between items-center" style="margin-bottom:24px;"><h3 id="expModalTitle" style="font-weight:700;font-size:1.1rem;">지출 내역 추가</h3><button onclick="closeExpenseModal()" style="background:none;color:var(--text2);font-size:1.3rem;">✕</button></div><div class="flex flex-col gap-12"><input type="hidden" id="expId" /><input type="hidden" id="expSettleStatus" /><div class="grid-2"><div class="form-group"><label class="form-label">지출일(발생일)</label><input type="date" id="expDate" class="form-input" /></div><div class="form-group"><label class="form-label">지출금액</label><input type="text" id="expAmount" class="form-input" placeholder="0원" oninput="formatMoneyInput(event)" /></div></div><div class="grid-2"><div class="form-group"><label class="form-label">결제 수단</label><select id="expPayMethod" class="form-select" onchange="handlePayMethodChange()"><option value="계좌이체">계좌이체</option><option value="신용카드">신용카드</option><option value="체크카드">체크카드</option><option value="현금/기타">현금/기타</option></select></div><div class="form-group" id="expFinanceWrap"><label class="form-label">출금 계좌 / 카드</label><select id="expFinanceSelect" class="form-select"><option value="">금융기관 선택</option></select></div></div><div class="grid-2"><div class="form-group"><label class="form-label">카테고리</label><select id="expCategory" class="form-select" onchange="handleCatChange()"></select><input type="text" id="expCategoryCustom" class="form-input" style="display:none;margin-top:6px;" placeholder="새 카테고리" /></div><div class="form-group"><label class="form-label">대상 호실 (선택)</label><select id="expRoom" class="form-select"><option value="">해당없음</option></select></div></div><div class="form-group"><label class="form-label">세부 항목명</label><input type="text" id="expDetail" class="form-input" /></div><div class="form-group"><label class="form-label">메모</label><textarea id="expMemo" class="form-textarea"></textarea></div><div class="form-group"><label class="form-label">증빙 자료 업로드</label><input type="file" id="expReceipts" multiple class="form-input" onchange="previewReceipts(event)"/><div id="expReceiptPreview" class="file-preview-list"></div></div><div class="flex justify-between mt-16" style="width:100%;border-top:1px solid var(--border);padding-top:20px;"><button id="exp-delete-btn" class="btn btn-danger" onclick="deleteExpenseRecord()" style="display:none;">삭제</button><div class="flex gap-8" style="margin-left:auto;"><button class="btn btn-secondary" onclick="closeExpenseModal()">닫기</button><button class="btn btn-primary" onclick="submitExpense()">저장</button></div></div></div></div></div>

<!-- 수익 모달 -->
<div id="incomeModal" style="display:none;position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,.7);backdrop-filter:blur(4px);overflow-y:auto;"><div style="background:var(--bg3);border-radius:18px;max-width:640px;margin:40px auto;padding:32px;border:1px solid var(--border2);"><div class="flex justify-between items-center" style="margin-bottom:24px;"><h3 id="incModalTitle" style="font-weight:700;font-size:1.1rem;color:var(--green);">부가 수익 추가</h3><button onclick="closeIncomeModal()" style="background:none;color:var(--text2);font-size:1.3rem;">✕</button></div><div class="flex flex-col gap-12"><input type="hidden" id="incId" /><div class="grid-2"><div class="form-group"><label class="form-label">수입일(입금일)</label><input type="date" id="incDate" class="form-input" /></div><div class="form-group"><label class="form-label">수입금액</label><input type="text" id="incAmount" class="form-input" placeholder="0원" oninput="formatMoneyInput(event)" /></div></div><div class="grid-2"><div class="form-group"><label class="form-label">입금 수단</label><select id="incPayMethod" class="form-select" onchange="handleIncPayMethodChange()"><option value="계좌이체">계좌이체</option><option value="신용카드">신용카드</option><option value="현금/기타">현금/기타</option></select></div><div class="form-group" id="incFinanceWrap"><label class="form-label">입금 계좌</label><select id="incFinanceSelect" class="form-select"><option value="">금융기관 선택</option></select></div></div><div class="form-group"><label class="form-label">카테고리</label><select id="incCategory" class="form-select" onchange="handleIncCatChange()"></select><input type="text" id="incCategoryCustom" class="form-input" style="display:none;margin-top:6px;" placeholder="새 카테고리" /></div><div class="form-group"><label class="form-label">세부 항목명</label><input type="text" id="incDetail" class="form-input"/></div><div class="form-group"><label class="form-label">메모</label><textarea id="incMemo" class="form-textarea"></textarea></div><div class="form-group"><label class="form-label">증빙 자료 업로드</label><input type="file" id="incReceipts" multiple class="form-input" onchange="previewIncReceipts(event)"/><div id="incReceiptPreview" class="file-preview-list"></div></div><div class="flex justify-between mt-16" style="width:100%;border-top:1px solid var(--border);padding-top:20px;"><button id="inc-delete-btn" class="btn btn-danger" onclick="deleteIncomeRecord()" style="display:none;">삭제</button><div class="flex gap-8" style="margin-left:auto;"><button class="btn btn-secondary" onclick="closeIncomeModal()">닫기</button><button class="btn btn-success" style="background:var(--green);border:none;color:#13161e;" onclick="submitIncome()">저장</button></div></div></div></div></div>

<!-- 수납 모달 -->
<div id="roomPaymentModal" style="display:none;position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,.7);backdrop-filter:blur(4px);overflow-y:auto;">
  <div style="background:var(--bg3);border-radius:18px;max-width:640px;margin:40px auto;padding:32px;border:1px solid var(--border2);">
    <div class="flex justify-between items-center" style="margin-bottom:20px;"><h3 style="font-weight:700;font-size:1.15rem;"><span id="pm-room-no" style="color:var(--accent);"></span> 수납 내역</h3>
    <button onclick="closePaymentModal()" style="background:none;color:var(--text2);font-size:1.3rem;">✕</button>
    </div>
    <div style="font-size:.95rem;color:var(--text2);margin-bottom:20px;padding-bottom:16px;border-bottom:1px dashed var(--border);">입주자: <strong id="pm-tenant-name" style="color:var(--text);"></strong> &nbsp;|&nbsp; 이용료: <strong id="pm-expected" style="color:var(--red);"></strong></div>
    <div class="card" style="padding:16px;margin-bottom:20px;background:var(--bg2);"><div style="font-weight:600;margin-bottom:12px;font-size:.95rem;color:var(--text);">이번 달 수납 기록</div><div id="pm-history-list" class="flex flex-col gap-8"></div></div>
    <div class="card" id="pm-add-section" style="padding:16px;border:1px solid var(--border2);display:none;">
      <div style="font-weight:600;margin-bottom:12px;font-size:.95rem;color:var(--accent);">+ 신규 수납 등록</div>
      <div class="flex items-center gap-8" style="flex-wrap:wrap;">
        <input type="date" id="pm-date" class="form-input" style="flex:1;min-width:120px;" />
        <input type="text" id="pm-amount" class="form-input" style="flex:1.5;min-width:120px;" placeholder="받은 금액" oninput="formatMoneyInput(event)" />
        <select id="pm-pay-method" class="form-select" style="flex:1;min-width:120px;"><option value="계좌이체">계좌이체</option><option value="신용카드">신용카드</option><option value="현금">현금</option><option value="[이전 원장 수납]">[이전 원장 수납]</option></select>
        <button class="btn btn-success" style="padding:10px 24px;" onclick="submitNewPayment()">저장</button>
      </div>
      <div id="pm-deposit-section" style="display:none; width:100%; margin-top:8px; padding:10px 14px; background:var(--bg); border:1px dashed var(--accent); border-radius:8px;">
        <div class="flex items-center gap-8" style="margin-bottom:8px;">
          <input type="checkbox" id="pm-include-deposit" class="form-checkbox" onchange="toggleDepositInput()"/>
          <label for="pm-include-deposit" style="font-size:.88rem; cursor:pointer;">보증금 포함 수납</label>
        </div>
        <div id="pm-deposit-input-wrap" style="display:none;">
          <input type="text" id="pm-deposit-amount" class="form-input" placeholder="보증금 금액" oninput="formatMoneyInput(event)" style="max-width:200px;"/>
          <div style="font-size:.8rem; color:var(--text3); margin-top:4px;">이용료와 별도로 보증금만큼 추가 수납됩니다.</div>
        </div>
      </div>
      </div>
    <div class="flex justify-end mt-16" style="width:100%;border-top:1px solid var(--border);padding-top:20px;gap:8px;"><button class="btn btn-secondary" onclick="closePaymentModal()">닫기</button><button id="pm-go-edit-btn" class="btn btn-primary" onclick="openPaymentModal(currentPaymentRoom.호실,'edit')">수납 등록 / 수정하기</button></div>
  </div>
</div>

<div id="depositSettleModal" style="display:none;position:fixed;inset:0;z-index:6000;background:rgba(0,0,0,.7);backdrop-filter:blur(4px);overflow-y:auto;">
  <div style="background:var(--bg3);border-radius:18px;max-width:480px;margin:40px auto;padding:32px;border:1px solid var(--border2);">
    <div class="flex justify-between items-center" style="margin-bottom:20px;">
      <h3 style="font-weight:700;font-size:1.1rem;">💰 보증금 정산</h3>
      <button onclick="closeDepositSettleModal()" style="background:none;color:var(--text2);font-size:1.3rem;">✕</button>
    </div>
    <div class="flex flex-col gap-12">
      <div class="deposit-settle-row"><span>보증금 총액</span><strong id="ds-total" style="color:var(--accent);">0원</strong></div>
      <div class="deposit-settle-row">
        <span>청소비 공제</span>
        <input type="text" id="ds-clean" class="form-input" style="width:150px;text-align:right;" oninput="formatMoneyInput(event); calcDepositSettle();" placeholder="0원"/>
      </div>
      <div class="deposit-settle-row">
        <span>파손 공제</span>
        <input type="text" id="ds-damage" class="form-input" style="width:150px;text-align:right;" oninput="formatMoneyInput(event); calcDepositSettle();" placeholder="0원"/>
      </div>
      <div class="deposit-settle-row">
        <span>미납금 공제</span>
        <strong id="ds-unpaid" style="color:var(--red);">0원</strong>
      </div>
      <div class="deposit-settle-row deposit-settle-total">
        <span>반환할 금액</span>
        <strong id="ds-refund">0원</strong>
      </div>
      <div class="form-group"><label class="form-label">정산 메모</label><textarea id="ds-memo" class="form-textarea" style="min-height:60px;"></textarea></div>
      <div class="flex gap-8 mt-16" style="justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeDepositSettleModal()">닫기</button>
        <button class="btn btn-primary" onclick="submitDepositSettle()">정산 완료 처리</button>
      </div>
    </div>
  </div>
</div>
<div class="spinner-overlay" id="spinner"><div class="spinner"></div><div class="spinner-text" id="spinnerText">처리 중입니다…</div></div>
<div class="toast" id="toast"></div>

<script>
// ============================================================
// 전역 변수
// ============================================================
let gTenants=[], gRooms=[], gFinance=[], gExpenses=[], gRoomStatus=[];
let gDash=null, gIncomes=[], gIncomeCategories=[], gCategories=[], gJobs=[];
window.gVisitRoutes = window.gVisitRoutes || [];
let currentTenTab='active', currentPaymentRoom=null;
let isSubmitting = false; // ✅ Bug #2: 버튼 연타 중복 제출 방지 플래그
// ✅ Bug #3: loadAll 연속 호출 방지용 debounce 유틸
function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
// loadAll 직접 호출 대신 이걸 쓴다 (400ms 안에 연속 호출 → 마지막 1번만 실행)
const safeLoadAll = debounce(() => loadAll(), 400);

const bankList=['신한은행','국민은행','우리은행','하나은행','기업은행','농협은행','카카오뱅크','토스뱅크','케이뱅크','새마을금고','우체국','SC제일은행','기타'];
const cardList=['신한카드','KB국민카드','삼성카드','현대카드','롯데카드','우리카드','하나카드','BC카드','NH농협카드','기타'];

window.addEventListener('DOMContentLoaded', () => {
  const now = new Date();
  document.getElementById('globalMonth').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  document.getElementById('expDate').value = toDateInput(now);
  document.getElementById('incDate').value = toDateInput(now);
  document.getElementById('globalMonth').addEventListener('change', () => loadAll());
  initTabs();
  initManageRoomFilter();
  initRoomStatusFilter();
  handleFinanceType();
  loadCountries();
  loadAll();
});

function loadCountries() {
  fetch('https://restcountries.com/v3.1/all?fields=translations,flag')
    .then(r => r.json())
    .then(data => {
      const sel = document.getElementById('m-nationality');
      data.map(c => ({ flag: c.flag, name: c.translations?.kor?.common || '' }))
        .filter(c => c.name && c.name !== '대한민국' && c.name !== '남한')
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(c => {
          const opt = document.createElement('option');
          opt.value = `${c.flag} ${c.name}`;
          opt.textContent = `${c.flag} ${c.name}`;
          sel.appendChild(opt);
        });
    }).catch(e => console.warn('국적 로딩 실패:', e));
}

// ============================================================
// 유틸리티
// ============================================================
function gm() { return document.getElementById('globalMonth').value; }
function toDateInput(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function fmtMoney(n) { return Number(n||0).toLocaleString()+'원'; }
function fmtMoneyShort(n) { n=Number(n); return n>=10000?(n/10000).toFixed(0)+'만원':n.toLocaleString()+'원'; }
function fmtResMoney(n) {
  const num=Number(String(n).replace(/[^0-9]/g,''))||0;
  if(num===0) return '<span style="color:var(--text3)">0원</span>';
  const m=num/10000; const mStr=Number.isInteger(m)?m+'만원':m.toFixed(1)+'만원';
  return `<span class="pc-money">${num.toLocaleString()}원</span><span class="mobile-money">${mStr}</span>`;
}
function showSpinner(msg='처리 중…') { document.getElementById('spinnerText').textContent=msg; document.getElementById('spinner').classList.add('show'); }
function hideSpinner() { document.getElementById('spinner').classList.remove('show'); }
function showToast(msg, type='success') { const el=document.getElementById('toast'); el.textContent=(type==='success'?'✅ ':'❌ ')+msg; el.className=`toast ${type} show`; setTimeout(()=>el.classList.remove('show'),3000); }

function getContactIconHtml(type) {
  const d={'카카오톡':'kakaotalk/FEE500','라인':'line/00C300','위챗':'wechat/07C160','텔레그램':'telegram/26A5E4','페이스북 메신저':'messenger/00B2FF','스냅챗':'snapchat/FFFC00'}[type];
  return d?`<img src="https://cdn.simpleicons.org/${d}" style="width:18px;height:18px;vertical-align:-4px;margin-right:6px;border-radius:4px;">`:`<span style="font-size:1.1rem;vertical-align:-2px;margin-right:4px;">${type==='미정'?'⏳':'📞'}</span>`;
}
function getFinanceLogoHtml(brand) {
  const domains={'신한은행':'shinhan.com','신한카드':'shinhancard.com','국민은행':'kbstar.com','KB국민카드':'kbcard.com','우리은행':'wooribank.com','우리카드':'wooricard.com','하나은행':'hanabank.com','하나카드':'hanacard.co.kr','기업은행':'ibk.co.kr','농협은행':'nhbank.com','NH농협카드':'card.nonghyup.com','카카오뱅크':'kakaobank.com','토스뱅크':'tossbank.com','케이뱅크':'kbanknow.com','삼성카드':'samsungcard.com','현대카드':'hyundaicard.com','롯데카드':'lottecard.co.kr','BC카드':'bccard.com','새마을금고':'kfcc.co.kr','우체국':'epost.go.kr','SC제일은행':'standardchartered.co.kr'};
  const d=domains[brand];
  return d?`<img src="https://www.google.com/s2/favicons?domain=${d}&sz=64" style="width:18px;height:18px;border-radius:50%;vertical-align:middle;margin-right:6px;background:#fff;" onerror="this.style.display='none'">`:`<span style="font-size:1.1rem;vertical-align:-2px;margin-right:4px;">${brand.includes('카드')?'💳':'🏦'}</span>`;
}

function calcDDay(day) {
  if(!day) return '';
  const s=String(day).trim(); const now=new Date();
  let due=s.includes('말')?new Date(now.getFullYear(),now.getMonth()+1,0):new Date(now.getFullYear(),now.getMonth(),Number(s.replace(/[^0-9]/g,''))||1);
  const diff=Math.round((new Date(due.getFullYear(),due.getMonth(),due.getDate())-new Date(now.getFullYear(),now.getMonth(),now.getDate()))/86400000);
  return diff===0?'D-Day':(diff>0?`D-${diff}`:`D+${Math.abs(diff)}`);
}

function calcDuration(moveInDate) {
  if(!moveInDate) return '—';
  const start=new Date(moveInDate); const now=new Date();
  if(start>now) return '입실 전';
  const diffDays=Math.ceil(Math.abs(now-start)/(1000*60*60*24));
  if(diffDays<30) return `${diffDays}일`;
  let months=(now.getFullYear()-start.getFullYear())*12+(now.getMonth()-start.getMonth());
  if(now.getDate()<start.getDate()) months--;
  if(months<1) return `${diffDays}일`;
  if(months<12) return `${months}개월`;
  const years=Math.floor(months/12); const rem=months%12;
  return rem>0?`${years}년 ${rem}개월`:`${years}년`;
}

function convertArea(type) {
  if(type==='py') { const py=parseFloat(document.getElementById('rm-area-py').value); document.getElementById('rm-area-m2').value=isNaN(py)?'':(py*3.3058).toFixed(2); }
  else { const m2=parseFloat(document.getElementById('rm-area-m2').value); document.getElementById('rm-area-py').value=isNaN(m2)?'':(m2/3.3058).toFixed(2); }
}

function getActualPaydayHtml(ym,pDay) {
  if(!pDay||String(pDay).includes('말')) return pDay;
  const dNum=Number(String(pDay).replace(/[^0-9]/g,''));if(!dNum) return pDay;
  let [yyyy,mm]=ym.split('-'); let d=new Date(Number(yyyy),Number(mm)-1,dNum);
  if(d.getDay()===6) d.setDate(d.getDate()+2); else if(d.getDay()===0) d.setDate(d.getDate()+1);
  return dNum!==d.getDate()?`${dNum}일 <span style="color:var(--text3);font-size:0.75rem;">(${d.getMonth()+1}/${d.getDate()} 출금)</span>`:`${dNum}일`;
}

// ============================================================
// 데이터 로드
// ============================================================
function loadAll() {
  showSpinner('데이터 동기화 중…');
  google.script.run.withSuccessHandler(res => {
    if(!res) { hideSpinner(); showToast('서버 응답 없음','error'); return; }
    gRooms=res.rooms||[]; gTenants=res.tenants||[]; gFinance=res.finance||[];
    gExpenses=res.expenses||[]; gIncomes=res.incomes||[]; gRoomStatus=res.roomStatus||[];
    gCategories=res.categories||['관리비','수선유지','세금','인건비','기타'];
    gIncomeCategories=res.incomeCategories||['건조기','세탁기','자판기','이자수익','기타'];

    // 직업 목록 동기화 (기본 + 시트에 있는 것)
    const jobDefaults=['미상','학생','직장인','전문직','자영업','배달','건설근로자','무직'];
    const jobSet=new Set(jobDefaults);
    gTenants.forEach(t=>{ const j=String(t['직업']||'').trim(); if(j&&!jobSet.has(j)) jobSet.add(j); });
    gJobs=Array.from(jobSet);
    if(res.visitRoutes) window.gVisitRoutes = res.visitRoutes;
    try {
      populateRoomSelectOptional(document.getElementById('expRoom'),'');
      renderRoomManageGrid(gRooms);
      renderFinanceTable();
      updateFinanceSelect();
      updateIncFinanceSelect();
      updateCategorySelect();
      updateIncCategorySelect();
      updateJobSelect();
      filterTenants();
      renderRoomGrid(gRoomStatus);
      renderExpenseTable();
      renderIncomeTable();
      if(document.getElementById('dash-ten-view').style.display!=='none') renderTenantDash();
      if(document.getElementById('exp-view-settle').style.display!=='none') renderSettleView();
      renderDashboard(res.dashboard); checkRoomTransferAlerts();
      initAllColSettings();
    } catch(e){ console.error(e); }
    hideSpinner();
  }).withFailureHandler(e=>{ hideSpinner(); showToast('로드 실패:'+e.message,'error'); }).getAppData(gm());
}

// ============================================================
// UI 탭 제어
// ============================================================
function initTabs() {
  document.querySelectorAll('.tab-nav .tab-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
      if(btn.dataset.tab==='dashboard'){ setTimeout(()=>{ if(trendChart) trendChart.resize(); if(catChart) catChart.resize(); },100); }
    });
  });
}
function switchDash(view) {
  if(view==='fin'){
    document.getElementById('dash-fin-view').style.display=''; document.getElementById('dash-ten-view').style.display='none';
    document.getElementById('btnDashFin').className='btn btn-primary btn-sm'; document.getElementById('btnDashTen').className='btn btn-secondary btn-sm';
    setTimeout(()=>{ if(trendChart) trendChart.resize(); if(catChart) catChart.resize(); },50);
  } else {
    document.getElementById('dash-fin-view').style.display='none'; document.getElementById('dash-ten-view').style.display='';
    document.getElementById('btnDashFin').className='btn btn-secondary btn-sm'; document.getElementById('btnDashTen').className='btn btn-primary btn-sm';
    renderTenantDash();
  }
}
function switchTenTab(tab) {
  currentTenTab=tab;
  document.querySelectorAll('#tab-tenants .sub-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('btn-ten-'+tab).classList.add('active');
  document.getElementById('tenantTitle').textContent=tab==='active'?'거주 및 예약자 목록':'퇴실/과거 기록';
  document.getElementById('btn-add-tenant').style.display=tab==='active'?'block':'none';
  const stSel=document.getElementById('tf-status');
  if(tab==='active'){ stSel.innerHTML='<option value="all">상태 (전체)</option><option value="거주중">거주중</option><option value="입실 예정">입실 예정</option><option value="퇴실 예정">퇴실 예정</option>'; }
  else { stSel.innerHTML='<option value="all">퇴실 완료</option>'; }
  filterTenants();
}
function switchExpTab(tabName) {
  document.querySelectorAll('#tab-expense .sub-btn').forEach(btn=>btn.classList.remove('active'));
  document.getElementById('btn-exp-'+tabName).classList.add('active');
  ['input','income','settle','manage'].forEach(n=>document.getElementById('exp-view-'+n).style.display='none');
  document.getElementById('exp-view-'+tabName).style.display=tabName==='manage'?'grid':'block';
  if(tabName==='settle') renderSettleView();
}
function changeMonth(delta) {
  const input=document.getElementById('globalMonth'); if(!input.value) return;
  let [year,month]=input.value.split('-');
  let d=new Date(year,parseInt(month)-1+delta,1);
  input.value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  input.dispatchEvent(new Event('change'));
}

// ============================================================
// 대시보드
// ============================================================
let trendChart=null, catChart=null, natChart=null, genderChart=null, jobChart=null;

function renderDashboard(d) {
  if(!d) return; gDash=d;
  document.getElementById('s-revenue').textContent=fmtMoneyShort(d.totalRevenue);
  document.getElementById('s-expense').textContent=fmtMoneyShort(d.totalExpense);
  const pEl=document.getElementById('s-profit'); pEl.textContent=fmtMoneyShort(d.netProfit); pEl.className='stat-val '+(d.netProfit>=0?'blue':'red');
  document.getElementById('s-rooms').textContent=`완납 ${d.paidCount}`;
  document.getElementById('s-rooms-sub').textContent=`미수납 ${d.unpaidCount} / 공실 ${d.vacantCount}`;
  if(d.trend) renderTrendChart(d.trend);
  if(d.catMap) renderCatChart(d.catMap);
  if(d.geminiComment) document.getElementById('geminiText').textContent=d.geminiComment;
  renderSchedules(d.schedules);
  
  // ▼ 여기서부터 함수 끝( } ) 직전까지 통째로 교체! ▼
  try {
    // 1. CRM 위젯이 있으면 실행하고, 없으면 무시!
    if (typeof renderCRMWidgets === 'function') {
      renderCRMWidgets(); 
    }
  } catch (e) { console.error("CRM 위젯 에러:", e); }
  
  try {
    // 2. 보증금 총액 계산
    const totalDeposit = (gTenants || []).filter(t => 
      t['보증금 여부'] === 'Y' && ['거주중','입주 대기','퇴실 예정'].includes(String(t['상태']).trim())
    ).reduce((s, t) => s + (Number(String(t['보증금 금액'] || '').replace(/[^0-9]/g, '')) || 0), 0);
    
    const depEl = document.getElementById('s-deposit');
    if(depEl) {
      depEl.textContent = totalDeposit.toLocaleString() + '원';
    }
  } catch (e) { console.error("보증금 계산 에러:", e); }

} // 🚨 이 닫는 괄호가 혹시 지워지지 않았나요? 없으면 꼭 추가해 주세요! 🚨

function renderSchedules(list) {
  const box=document.getElementById('dash-schedule-box');
  if(!list||!list.length){ box.style.display='none'; return; }
  let html=`<div class="card" style="border-left:4px solid var(--accent2);"><div style="font-weight:700;font-size:1.05rem;color:var(--accent2);margin-bottom:12px;">예정 스케줄 및 알림</div><div class="flex flex-col gap-8">`;
  list.forEach(s=>{
    if(s.type==='wish'){
      html+=`<div style="background:rgba(255,184,48,.08);border:1px solid var(--yellow);padding:10px 14px;border-radius:8px;font-size:.88rem;">✨ <strong>${s.roomNo}호 ${s.tenantName}님</strong>이 희망하신 <strong style="color:var(--yellow);">${s.wishRoom}호</strong>가 공실이 되었습니다!</div>`;
    } else {
      const isOut=s.type==='out'; const bColor=isOut?'badge-red':'badge-blue'; const act=isOut?'퇴실 예정':'입실 예정';
      const dStr=s.dday===0?'오늘':(s.dday>0?`D-${s.dday}`:`D+${Math.abs(s.dday)} 경과`);
      const btnHtml=s.dday<=0?`<button class="btn btn-sm ${isOut?'btn-danger':'btn-primary'}" onclick="processSchedule('${s.type}','${s.tenantId}')">${isOut?'퇴실':'입실'} 처리</button>`:'';
      html+=`<div class="flex items-center justify-between" style="background:var(--bg2);padding:10px 14px;border-radius:8px;border:1px solid var(--border);"><div><span class="badge ${bColor}">${act}</span> <strong style="margin:0 8px;">${s.roomNo}호 ${s.tenantName}님</strong> <span style="color:var(--text2);font-size:.85rem;">(${s.date}, ${dStr})</span></div>${btnHtml}</div>`;
    }
  });
  box.innerHTML=html+'</div></div>'; box.style.display='block';
}

function processSchedule(type,tId) {
  if(!confirm(`해당 입주자의 ${type==='out'?'퇴실':'입실'} 처리를 완료하시겠습니까?`)) return;
  showSpinner('처리 중...');
  google.script.run.withSuccessHandler(r=>loadAll()).withFailureHandler(e=>{ hideSpinner(); showToast(e.message,'error'); })[type==='out'?'backendCheckoutTenant':'backendMoveInTenant'](tId);
}

function renderTenantDash() {
  const active=gTenants.filter(t=>['거주중','입실 예정'].includes(String(t['상태']).trim()));
  document.getElementById('s-tenant-total').textContent=active.length+'명';
  const foreignCount=active.filter(t=>t['국적']&&!String(t['국적']).includes('대한민국')).length;
  document.getElementById('s-tenant-foreign').textContent=Math.round((foreignCount/(active.length||1))*100)+'% ('+foreignCount+'명)';
  const natMap={},genderMap={},jobMap={};
  active.forEach(t=>{
    const n=t['국적']?String(t['국적']).replace(/[^가-힣a-zA-Z\s]/g,'').trim():'미상';
    const g=String(t['성별']||'미상'); const j=String(t['직업']||'미상');
    natMap[n]=(natMap[n]||0)+1; genderMap[g]=(genderMap[g]||0)+1; jobMap[j]=(jobMap[j]||0)+1;
  });
  setTimeout(()=>{ drawPieChart('natChart',natMap); drawPieChart('genderChart',genderMap); drawBarChart('jobChart',jobMap); },50);
}

function drawPieChart(id,map) {
  if(window[id+'Obj']) window[id+'Obj'].destroy();
  const k=Object.keys(map); const v=Object.values(map); if(!k.length) return;
  window[id+'Obj']=new Chart(document.getElementById(id),{ type:'doughnut', data:{ labels:k, datasets:[{ data:v, backgroundColor:['#4f7fff','#7c5cfc','#22c98a','#ffb830','#ff5370','#8b92a8'].slice(0,k.length), borderWidth:0 }] }, options:{ responsive:true, maintainAspectRatio:false, cutout:'65%', plugins:{ legend:{ position:'right', labels:{ color:'#8b92a8', font:{ size:11 } } } } } });
}

function drawBarChart(id,map) {
  if(window[id+'Obj']) window[id+'Obj'].destroy();
  const k=Object.keys(map).sort((a,b)=>map[b]-map[a]); const v=k.map(x=>map[x]); if(!k.length) return;
  window[id+'Obj']=new Chart(document.getElementById(id),{ type:'bar', data:{ labels:k, datasets:[{ label:'명', data:v, backgroundColor:'#4f7fff', borderRadius:4 }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ x:{ grid:{ display:false }, ticks:{ color:'#8b92a8', font:{ size:11 } } }, y:{ grid:{ color:'#252a38' }, ticks:{ color:'#555e78', stepSize:1, font:{ size:11 } } } } } });
}

function renderTrendChart(trend) {
  if(trendChart) trendChart.destroy();
  trendChart=new Chart(document.getElementById('trendChart'),{ type:'line', data:{ labels:trend.map(t=>t.month), datasets:[{ label:'매출', data:trend.map(t=>t.revenue), borderColor:'#22c98a', backgroundColor:'rgba(34,201,138,.08)', tension:.4, pointRadius:4 },{ label:'지출', data:trend.map(t=>t.expense), borderColor:'#ff5370', backgroundColor:'rgba(255,83,112,.08)', tension:.4, pointRadius:4 },{ label:'순수익', data:trend.map(t=>t.profit), borderColor:'#4f7fff', backgroundColor:'rgba(79,127,255,.08)', tension:.4, pointRadius:4 }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:'#8b92a8', font:{ size:11 } } } }, scales:{ x:{ grid:{ color:'#252a38' }, ticks:{ color:'#555e78', font:{ size:11 } } }, y:{ grid:{ color:'#252a38' }, ticks:{ color:'#555e78', font:{ size:11 }, callback:v=>fmtMoneyShort(v) } } } } });
}

function renderCatChart(catMap) {
  if(catChart) catChart.destroy();
  const keys=Object.keys(catMap); const vals=Object.values(catMap); if(!keys.length) return;
  catChart=new Chart(document.getElementById('catChart'),{ type:'doughnut', data:{ labels:keys, datasets:[{ data:vals, backgroundColor:['#4f7fff','#7c5cfc','#22c98a','#ffb830','#ff5370','#ff7a3d'].slice(0,keys.length), borderWidth:0 }] }, options:{ responsive:true, maintainAspectRatio:false, cutout:'65%', plugins:{ legend:{ position:'right', labels:{ color:'#8b92a8', font:{ size:11 }, padding:14 } } } } });
}

function refreshGemini() {
  showSpinner('분석 중…');
  google.script.run.withSuccessHandler(r=>{ hideSpinner(); if(r.ok){ document.getElementById('geminiText').textContent=r.comment; showToast('완료'); } }).withFailureHandler(e=>{ hideSpinner(); showToast(e.message,'error'); }).analyzeWithGemini(gm());
}

// ============================================================
// 통합 수납 현황 - 셀별 클릭 분리
// ============================================================
let rsSortKey='default', rsSortAsc=true;
function sortRoomGrid(key) { if(rsSortKey===key){ rsSortAsc=!rsSortAsc; } else { rsSortKey=key; rsSortAsc=true; } renderRoomGrid(gRoomStatus); }

function renderRoomGrid(data) {
  const tbody=document.getElementById('roomGrid');
  if(!data||!data.length){ tbody.innerHTML='<tr><td colspan="10" class="empty-state">데이터가 없습니다.</td></tr>'; return; }
  const valid=data.filter(r=>r&&r.호실&&String(r.호실).trim()!==''&&String(r.호실).trim()!=='호실');

  valid.sort((a,b)=>{
    let vA,vB;
    if(rsSortKey==='호실'){ vA=Number(String(a.호실).replace(/[^0-9]/g,''))||0; vB=Number(String(b.호실).replace(/[^0-9]/g,''))||0; }
    else if(rsSortKey==='잔액'){ vA=Number(a.잔액)||0; vB=Number(b.잔액)||0; }
    else if(rsSortKey==='이름'){ vA=a.공실?'힇':a.입주자명||''; vB=b.공실?'힇':b.입주자명||''; }
    else if(rsSortKey==='방타입'){ vA=a.방타입||''; vB=b.방타입||''; }
    else if(rsSortKey==='창문'){ vA=a.창문||''; vB=b.창문||''; }
    else if(rsSortKey==='예정금액'){ vA=Number(a.수납예정금액)||0; vB=Number(b.수납예정금액)||0; }
    else if(rsSortKey==='총수납액'){ vA=Number(a.총수납액)||0; vB=Number(b.총수납액)||0; }
    else if(rsSortKey==='상태'){
      // ✅ 기존 '상태' 컬럼 클릭 정렬은 그대로 유지
      const _dd=r=>{const d=String(r.수납예정일||'').trim();if(!d)return 999;const now=new Date();let due=d.includes('말')?new Date(now.getFullYear(),now.getMonth()+1,0):new Date(now.getFullYear(),now.getMonth(),Number(d.replace(/[^0-9]/g,''))||1);return Math.round((new Date(due.getFullYear(),due.getMonth(),due.getDate())-new Date(now.getFullYear(),now.getMonth(),now.getDate()))/86400000);};
      const grpA=a.공실?2:(a.잔액>=0?1:0);
      const grpB=b.공실?2:(b.잔액>=0?1:0);
      if(grpA!==grpB) return grpA-grpB;
      return rsSortAsc?(_dd(a)-_dd(b)):(_dd(b)-_dd(a));
    }
    // ✅ NEW: 기본 정렬 — 수납 상태 및 D-day 우선 정렬
    else if(rsSortKey==='default'){
      // D-day 파싱 헬퍼: 수납예정일(문자열) → 오늘 기준 일수 차이
      // 음수 = 연체(예: -20은 20일 연체), 양수 = 기한 여유
      const getDueDiff = r => {
        const d = String(r.수납예정일 || '').trim();
        if(!d) return 9999; // 수납예정일 없으면 맨 뒤
        const now = new Date();
        const due = d.includes('말')
          ? new Date(now.getFullYear(), now.getMonth() + 1, 0)          // 말일 처리
          : new Date(now.getFullYear(), now.getMonth(), Number(d.replace(/[^0-9]/g, '')) || 1);
        return Math.round(
          (new Date(due.getFullYear(), due.getMonth(), due.getDate()) -
           new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000
        );
      };

      if(rsSortAsc) {
        // 오름차순: 미수납(연체 심한 순=가장 음수) → 완납 → 공실
        const grpA = a.공실 ? 2 : (Number(a.잔액) < 0 ? 0 : 1);
        const grpB = b.공실 ? 2 : (Number(b.잔액) < 0 ? 0 : 1);
        if(grpA !== grpB) return grpA - grpB;
        // 미수납끼리: getDueDiff 오름차순 → -20, -14, -2, 0, +3 순
        return getDueDiff(a) - getDueDiff(b);
      } else {
        // 내림차순: 완납 → 미수납(기한 많이 남은 순=가장 양수) → 공실
        const grpA = a.공실 ? 2 : (Number(a.잔액) >= 0 ? 0 : 1);
        const grpB = b.공실 ? 2 : (Number(b.잔액) >= 0 ? 0 : 1);
        if(grpA !== grpB) return grpA - grpB;
        // 미수납끼리: getDueDiff 내림차순 → +30, +14, +3, -2, -20 순
        return getDueDiff(b) - getDueDiff(a);
      }
    }
    else {
      // 인식되지 않은 키의 최후 fallback (호실 번호 순)
      vA=Number(String(a.호실).replace(/[^0-9]/g,''))||0;
      vB=Number(String(b.호실).replace(/[^0-9]/g,''))||0;
    }
    if(vA<vB) return rsSortAsc?-1:1;
    if(vA>vB) return rsSortAsc?1:-1;
    return 0;
  });

  tbody.innerHTML=valid.map(r=>{
    const fKey=String(r.호실).charAt(0);
    const rType=r.방타입||'미지정';
    const winType=r.창문||'-';

    // 공실 행
    if(r.공실){
      return `<tr class="room-row" data-floor="${fKey}" data-status="vacant">
        <td class="clickable-cell" onclick="openRoomManageModal('${r.호실}')" title="호실 정보 수정"><strong style="color:var(--text2);">${r.호실}호</strong></td>
        <td class="clickable-cell res-job" onclick="openRoomManageModal('${r.호실}')" title="호실 정보 수정"><span style="color:var(--text2);font-size:.85rem;">${rType}</span></td>
        <td class="clickable-cell res-job" onclick="openRoomManageModal('${r.호실}')" title="호실 정보 수정"><span style="color:var(--text3);font-size:.8rem;">${winType}</span></td>
        <td colspan="6"><span style="color:var(--text3);font-size:.85rem;">공실입니다</span></td>
        <td><span class="badge badge-gray">공실</span></td>
      </tr>`;
    }

    const expNum=Number(r.수납예정금액)||0;
    const totPaid=Number(r.총수납액)||0;
    const bal=Number(r.잔액)||0;
    const depNum=Number(String(r.보증금금액||'').replace(/[^0-9]/g,''))||0;
    const carry=Number(r.이월금)||0;
    const isPaid=bal>=0;
    const dday=calcDDay(String(r.수납예정일));
    const ddayHtml=dday&&!isPaid?` <span class="badge ${dday.indexOf('D+')===0||dday==='D-Day'?'badge-red':'badge-yellow'}">${dday}</span>`:'';
    const rStatus=r.상태||'거주중';

    let balHtml='';
    if(bal<0) balHtml=`<span style="color:var(--red);font-weight:700;">${fmtMoney(bal)}</span>`;
    else if(bal>0) balHtml=`<span style="color:var(--green);font-weight:700;">+${fmtMoney(bal)}</span>`;
    else balHtml=`<span style="color:var(--text3);font-weight:700;">0원</span>`;

    let totPaidHtml=fmtResMoney(totPaid);
    if(carry>0) totPaidHtml+=`<br><span style="font-size:.75rem;color:var(--text3);">(이월 +${fmtMoneyShort(carry)})</span>`;

    let sbHtml=isPaid?`<span class="badge badge-green">완납</span>`:`<span class="badge badge-red">미수납</span>${ddayHtml}`;
    if(rStatus==='입실 예정') sbHtml=`<span class="badge badge-blue">입실 예정</span>`;

    const fSt=isPaid?'paid':'unpaid';
    const conHtml=`<div style="display:flex;align-items:center;">${getContactIconHtml(r.연락수단||'휴대전화')}<span>${r.연락처||''}</span></div>`;

    // 호실/타입/창문 → 호실 관리 팝업
    // 입주자명/연락처 → 입주자 상세 팝업
    // 보증금/이용료/총수납/잔액/상태 → 수납 내역 팝업
    return `<tr class="room-row ${isPaid?'':'unpaid-row'}" data-floor="${fKey}" data-status="${fSt}">
      <td class="clickable-cell" onclick="openRoomManageModal('${r.호실}')" title="호실 정보"><strong style="color:var(--accent);">${r.호실}호</strong></td>
      <td class="clickable-cell res-job" onclick="openRoomManageModal('${r.호실}')" title="호실 정보"><span style="color:var(--text2);font-size:.85rem;">${rType}</span></td>
      <td class="clickable-cell res-job" onclick="openRoomManageModal('${r.호실}')" title="호실 정보"><span style="color:var(--text3);font-size:.8rem;">${winType}</span></td>
      <td class="clickable-cell" onclick="openTenantModal('${r.입주자ID}','view')" title="입주자 정보"><strong class="truncate-name">${r.입주자명}</strong>${rStatus==='입실 예정'?' <span class="badge badge-blue" style="font-size:.7rem;padding:2px 6px;">예약</span>':(rStatus==='퇴실 예정'?' <span class="badge badge-red" style="font-size:.7rem;padding:2px 6px;">퇴실예정</span>':'')}</td>
      <td class="clickable-cell res-demo" onclick="openTenantModal('${r.입주자ID}','view')" title="입주자 정보">${conHtml}</td>
      <td class="clickable-cell" onclick="openPaymentModal('${r.호실}','view')" style="color:var(--text3);">${fmtResMoney(depNum)}</td>
      <td class="clickable-cell" onclick="openPaymentModal('${r.호실}','view')">${fmtResMoney(expNum)}</td>
      <td class="clickable-cell res-job" onclick="openPaymentModal('${r.호실}','view')" style="color:var(--green);font-weight:600;">${totPaidHtml}</td>
      <td class="clickable-cell" onclick="openPaymentModal('${r.호실}','view')">${balHtml}</td>
      <td class="clickable-cell" onclick="openPaymentModal('${r.호실}','view')">${sbHtml}</td>
    </tr>`;
  }).join('');

  ['호실','방타입','창문','이름','예정금액','총수납액','잔액','상태'].forEach(k=>{ const el=document.getElementById('sort-'+k); if(el) el.textContent=(rsSortKey===k)?(rsSortAsc?' ▲':' ▼'):'';
  });
  applyRoomStatusFilters();
}

function applyRoomStatusFilters() {
  const fFl=document.getElementById('rsf-floor').value; const fSt=document.getElementById('rsf-status').value;
  document.querySelectorAll('#roomGrid .room-row').forEach(row=>{
    let s=true;
    if(fFl!=='all'&&row.dataset.floor!==fFl) s=false;
    if(fSt!=='all'&&row.dataset.status!==fSt) s=false;
    row.style.display=s?'':'none';
  });
}
function resetRoomStatusFilters() { document.getElementById('rsf-floor').value='all'; document.getElementById('rsf-status').value='all'; applyRoomStatusFilters(); }
function initRoomStatusFilter() { document.querySelectorAll('#roomStatusFilter .filter-select').forEach(s=>s.addEventListener('change',applyRoomStatusFilters)); }

// ============================================================
// 수납 모달
// ============================================================
function openPaymentModal(no, mode='view') {
  const r=gRoomStatus.find(x=>String(x.호실)===String(no)); if(!r) return;
  currentPaymentRoom=r;
  document.getElementById('pm-room-no').textContent=r.호실+'호';
  document.getElementById('pm-tenant-name').textContent=r.입주자명;
  document.getElementById('pm-expected').textContent=fmtMoney(r.수납예정금액);
  document.getElementById('pm-date').value=toDateInput(new Date());
  document.getElementById('pm-amount').value='';
  try {
    // 1. 함수 안에 기존에 선언된 방 번호(roomNo)나 객체(r, currentPaymentRoom)를 안전하게 찾습니다.
    let currentRoomNo = '';
    if (typeof roomNo !== 'undefined') currentRoomNo = roomNo;
    else if (typeof currentPaymentRoom !== 'undefined') currentRoomNo = currentPaymentRoom.호실;
    else if (typeof r !== 'undefined' && r.호실) currentRoomNo = r.호실;

    const targetRoom = gRoomStatus.find(x => String(x.호실) === String(currentRoomNo));
    const depSection = document.getElementById('pm-deposit-section');
    
    // 2. 에러가 나지 않도록 targetRoom이 확실히 있을 때만 보증금을 확인합니다.
    if (depSection) {
      if (targetRoom && (targetRoom.보증금여부 === 'Y' || targetRoom.보증금여부 === '있음')) {
        depSection.style.display = 'block';
      } else {
        depSection.style.display = 'none';
      }
    }
  } catch (e) {
    console.error("보증금 섹션 토글 중 에러 발생 (무시하고 계속 진행):", e);
  }
  document.getElementById('pm-add-section').style.display=mode==='edit'?'block':'none';
  document.getElementById('pm-go-edit-btn').style.display=mode==='edit'?'none':'block';
  renderPaymentModalHistory(r,mode);
  document.getElementById('roomPaymentModal').style.display='block';
}
function closePaymentModal() { document.getElementById('roomPaymentModal').style.display='none'; }

// 1. 수납 모달 UI 업그레이드 (메모가 큼직하게 보이도록 수정)
function renderPaymentModalHistory(room, mode) {
  const list = room.수납내역 || [];
  const listEl = document.getElementById('pm-history-list');
  if (!list.length) {
    listEl.innerHTML = '<div style="color:var(--text3);font-size:.85rem;padding:12px;text-align:center;">이번 달 수납 내역이 없습니다.</div>';
    return;
  }
  listEl.innerHTML = list.sort((a, b) => Number(a['수납 회차']) - Number(b['수납 회차'])).map(p => {
    const isP = String(p['결제수단']) === '[이전 원장 수납]';
    
    // ▼ 메모가 있으면 눈에 확 띄게 표시하는 박스 추가! ▼
    const memoHtml = p['메모'] ? `<div style="font-size:0.8rem; color:var(--accent2); margin-top:8px; padding:8px 12px; background:rgba(124,92,252,0.08); border-radius:6px; font-weight:500;">💡 ${p['메모']}</div>` : '';

    if (mode === 'view') {
      return `<div class="flex flex-col" style="background:var(--bg);padding:12px 16px;border-radius:8px;border:1px solid ${isP ? 'var(--red)' : 'var(--border)'}; margin-bottom:8px;">
                <div class="flex items-center justify-between gap-8">
                  <span style="font-size:.85rem;color:var(--text2);">${p['수납 회차']}회차</span>
                  <span style="font-weight:600;">${p['수납일']}</span>
                  <span style="font-weight:700;color:var(--accent);">${fmtMoney(p['실제 수납 금액'])}</span>
                  <span class="badge badge-gray">${p['결제수단']}</span>
                </div>
                ${memoHtml}
              </div>`;
    } else {
      const opt = isP ? `<option value="[이전 원장 수납]" selected>[이전 원장 수납]</option>` : `<option value="계좌이체" ${p['결제수단'] === '계좌이체' ? 'selected' : ''}>계좌이체</option><option value="신용카드" ${p['결제수단'] === '신용카드' ? 'selected' : ''}>신용카드</option><option value="현금" ${p['결제수단'] === '현금' ? 'selected' : ''}>현금</option><option value="[이전 원장 수납]">[이전 원장 수납]</option>`;
      return `<div class="flex flex-col" style="background:var(--bg);padding:12px 16px;border-radius:8px;border:1px solid ${isP ? 'var(--red)' : 'var(--border)'}; margin-bottom:8px;">
                <div class="flex items-center justify-between gap-8 flex-wrap">
                  <span style="font-size:.85rem;color:var(--text2);width:45px;">${p['수납 회차']}회차</span>
                  <input type="date" id="pe-date-${p['수납 ID']}" value="${p['수납일']}" class="form-input" style="width:130px;padding:6px 10px;" />
                  <input type="text" id="pe-amt-${p['수납 ID']}" value="${fmtMoney(p['실제 수납 금액'])}" class="form-input" style="flex:1;padding:6px 10px;min-width:100px;" oninput="formatMoneyInput(event)" />
                  <select id="pe-method-${p['수납 ID']}" class="form-select" style="width:130px;padding:6px 10px;">${opt}</select>
                  <button class="btn btn-secondary btn-sm" onclick="updateExistingPayment('${p['수납 ID']}')">저장</button>
                  <button class="btn btn-danger btn-sm" onclick="deleteExistingPayment('${p['수납 ID']}')">✕</button>
                </div>
                ${memoHtml}
              </div>`;
    }
  }).join('');
}

// 2. 신규 수납 로직 업그레이드 (메모에 상세 내역을 텍스트로 친절하게 적어줌)
function submitNewPayment() {
  if (!currentPaymentRoom) return;
  const date = document.getElementById('pm-date').value;
  const rawAmt = document.getElementById('pm-amount').value;
  const met = document.getElementById('pm-pay-method').value;

  let totalAmount = Number(rawAmt.replace(/[^0-9]/g, '')) || 0;
  if (!date || totalAmount <= 0) return showToast('날짜와 금액을 입력해주세요.', 'error');

  const includeDepChk = document.getElementById('pm-include-deposit');
  const includeDep = includeDepChk ? includeDepChk.checked : false;
  const depAmtStr = document.getElementById('pm-deposit-amount') ? document.getElementById('pm-deposit-amount').value : '';
  const depAmt = Number(depAmtStr.replace(/[^0-9]/g, '')) || 0;

  let rentAmount = totalAmount;
  let memoStr = '';

  if (includeDep && depAmt > 0) {
    if (totalAmount < depAmt) return showToast('보증금보다 입금액이 적습니다.', 'error');
    rentAmount = totalAmount - depAmt;
    memoStr = `총 입금액: ${totalAmount.toLocaleString()}원 (월세: ${rentAmount.toLocaleString()}원 / 보증금: ${depAmt.toLocaleString()}원 별도 적립)`;
    google.script.run.updateTenantDepositOnly(currentPaymentRoom.입주자ID, depAmt);
  }

  const targetM = document.getElementById('globalMonth').value || gm();
  if (isSubmitting) return showToast('처리 중입니다. 잠시 후 다시 시도해주세요.', 'error'); // ✅
  isSubmitting = true;                                                                        // ✅
  showSpinner('수납 기록 추가 중...');
  google.script.run
    .withSuccessHandler(() => {
      showToast('수납이 등록되었습니다.');
      google.script.run
        .withSuccessHandler(res => {
          hideSpinner();
          isSubmitting = false;                                                               // ✅
          gRooms = res.rooms; gTenants = res.tenants; gRoomStatus = res.roomStatus;
          gDash = res.dashboard; gExpenses = res.expenses; gIncomes = res.incomes;
          openPaymentModal(currentPaymentRoom.호실, 'view');
          renderRoomGrid(gRoomStatus);
          filterTenants();
          renderDashboard(gDash);
        })
        .withFailureHandler(e => {                                                            // ✅
          hideSpinner();
          isSubmitting = false;
          showToast('데이터 갱신 실패: ' + e.message, 'error');
        })
        .getAppData(targetM);
    })
    .withFailureHandler(e => {                                                                // ✅
      hideSpinner();
      isSubmitting = false;
      showToast('수납 저장 실패: ' + e.message, 'error');
    })
    .savePayment({ roomNo: currentPaymentRoom.호실, tenantId: currentPaymentRoom.입주자ID, tenantName: currentPaymentRoom.입주자명, expectedAmount: currentPaymentRoom.수납예정금액, amount: rentAmount, payDate: date, targetMonth: targetM, payMethod: met, memo: memoStr });
}

// 2. [기존 수납 내역 수정] - 수정 후 즉시 리스트 반영!
function updateExistingPayment(pid) {
  const d = document.getElementById('pe-date-'+pid).value;
  const a = document.getElementById('pe-amt-'+pid).value.replace(/[^0-9]/g,'');
  const m = document.getElementById('pe-method-'+pid).value;

  if(!d||!a) return showToast('날짜와 금액을 확인해주세요.','error');
  if (isSubmitting) return showToast('처리 중입니다.', 'error');
  isSubmitting = true;
  showSpinner('수정 저장 중...');

  google.script.run
    .withSuccessHandler(r => {
      if(!r.ok){ hideSpinner(); isSubmitting = false; showToast(r.msg,'error'); return; }
      showToast('수정되었습니다.');
      const targetM = document.getElementById('globalMonth').value || gm();
      google.script.run
        .withSuccessHandler(res => {
          hideSpinner();
          isSubmitting = false;
          gRooms = res.rooms; gTenants = res.tenants; gRoomStatus = res.roomStatus;
          gDash = res.dashboard; gExpenses = res.expenses; gIncomes = res.incomes;
          openPaymentModal(currentPaymentRoom.호실, 'edit');
          renderRoomGrid(gRoomStatus);
          filterTenants();
          renderDashboard(gDash);
        })
        .withFailureHandler(e => {
          hideSpinner();
          isSubmitting = false;
          showToast('데이터 갱신 실패: ' + e.message, 'error');
        })
        .getAppData(targetM);
    })
    .withFailureHandler(e => {
      hideSpinner();
      isSubmitting = false;
      showToast('수정 실패: ' + e.message, 'error');
    })
    .updatePaymentRecord(pid, d, a, m);
}

// 3. [기존 수납 내역 삭제] - 삭제 후 즉시 리스트 반영!
function deleteExistingPayment(pid) {
  if(!confirm('이 수납 기록을 삭제하시겠습니까?')) return;
  if (isSubmitting) return showToast('처리 중입니다.', 'error');
  isSubmitting = true;
  showSpinner('삭제 중...');

  google.script.run
    .withSuccessHandler(r => {
      if(!r.ok){ hideSpinner(); isSubmitting = false; showToast(r.msg,'error'); return; }
      showToast('삭제되었습니다.');
      const targetM = document.getElementById('globalMonth').value || gm();
      google.script.run
        .withSuccessHandler(res => {
          hideSpinner();
          isSubmitting = false;
          gRooms = res.rooms; gTenants = res.tenants; gRoomStatus = res.roomStatus;
          gDash = res.dashboard; gExpenses = res.expenses; gIncomes = res.incomes;
          openPaymentModal(currentPaymentRoom.호실, 'view');
          renderRoomGrid(gRoomStatus);
          filterTenants();
          renderDashboard(gDash);
        })
        .withFailureHandler(e => {
          hideSpinner();
          isSubmitting = false;
          showToast('데이터 갱신 실패: ' + e.message, 'error');
        })
        .getAppData(targetM);
    })
    .withFailureHandler(e => {
      hideSpinner();
      isSubmitting = false;
      showToast('삭제 실패: ' + e.message, 'error');
    })
    .deletePaymentRecord(pid);
}
// ============================================================
// 입주자 관리 테이블 - 호실 셀 클릭 → 호실 모달
// ============================================================
let tenantSortKey='default', tenantSortAsc=true;
function sortTenantGrid(k) { if(tenantSortKey===k) tenantSortAsc=!tenantSortAsc; else { tenantSortKey=k; tenantSortAsc=true; } filterTenants(); }

function renderTenantTable(data) {
  const tbody=document.getElementById('tenantBody');
  if(!data||!data.length){ tbody.innerHTML='<tr><td colspan="14" class="empty-state">데이터가 없습니다.</td></tr>'; return; }

  data.sort((a,b)=>{
    let vA,vB;
    if(tenantSortKey==='ID'){ vA=a['입주자 ID']||''; vB=b['입주자 ID']||''; }
    else if(tenantSortKey==='호실'){ vA=Number(String(a['현재 호실']).replace(/[^0-9]/g,''))||0; vB=Number(String(b['현재 호실']).replace(/[^0-9]/g,''))||0; }
    else if(tenantSortKey==='이름'){ vA=a['입주자명']||''; vB=b['입주자명']||''; }
    else if(tenantSortKey==='수납일'){ vA=Number(String(a['수납 예정일']).replace(/[^0-9]/g,''))||31; vB=Number(String(b['수납 예정일']).replace(/[^0-9]/g,''))||31; }
    else if(tenantSortKey==='금액'){ vA=Number(String(a['수납 예정 금액']).replace(/[^0-9]/g,''))||0; vB=Number(String(b['수납 예정 금액']).replace(/[^0-9]/g,''))||0; }
    else if(tenantSortKey==='상태'){ vA=a['상태']||''; vB=b['상태']||''; }
    else if(tenantSortKey==='보증금'){ vA=Number(String(a['보증금 금액']).replace(/[^0-9]/g,''))||0; vB=Number(String(b['보증금 금액']).replace(/[^0-9]/g,''))||0; }
    else if(tenantSortKey==='예정일'){ 
      const getD=t=>{ if(t['상태']==='입실 예정'&&t['입주일']) return new Date(t['입주일']).getTime(); if(t['상태']==='퇴실 예정'&&t['퇴실 예정일']) return new Date(t['퇴실 예정일']).getTime(); return 9999999999999; };
      vA=getD(a); vB=getD(b);}  
    else if(tenantSortKey==='국적'){ vA=a['국적']||''; vB=b['국적']||''; }
    else if(tenantSortKey==='성별'){ vA=a['성별']||''; vB=b['성별']||''; }
    else if(tenantSortKey==='직업'){ vA=a['직업']||''; vB=b['직업']||''; }
    else if(tenantSortKey==='결제수단'){ vA=a['주 결제 수단']||''; vB=b['주 결제 수단']||''; }
    else if(tenantSortKey==='거주기간'){ vA=new Date(a['입주일']||0).getTime(); vB=new Date(b['입주일']||0).getTime(); }
    else { vA=0; vB=0; }
    if(vA<vB) return tenantSortAsc?-1:1;
    if(vA>vB) return tenantSortAsc?1:-1;
    return Number(String(a['현재 호실']).replace(/[^0-9]/g,''))-Number(String(b['현재 호실']).replace(/[^0-9]/g,''));
  });

  tbody.innerHTML=data.map(t=>{
    const isPast=String(t['상태']).trim()==='퇴실';
    const stB={'거주중':'badge-green','퇴실':'badge-gray','입실 예정':'badge-blue','퇴실 예정':'badge-red'}[t['상태']]||'badge-gray';
    const cleanDue=String(t['수납 예정일']||'').replace(/일/g,'');
    const dueT=cleanDue.includes('말')?'말일':(cleanDue?cleanDue+'일':'—');
    const job=String(t['직업']||'미상');
    const jC=job.includes('수급자')?'badge-yellow':(job.includes('미상')||job.includes('미상')?'badge-gray':'badge-blue');
    const cHtml=`<div style="display:flex;align-items:center;">${getContactIconHtml(t['연락 수단']||'휴대전화')}<span>${t['연락처']||''}</span></div>`;
    const depA=Number(String(t['보증금 금액']).replace(/[^0-9]/g,''))||0;

    let targetDateStr='<span style="color:var(--text3)">-</span>';
    if(t['상태']==='입실 예정'&&t['입주일']){ const d=new Date(t['입주일']); targetDateStr=`${d.getMonth()+1}/${d.getDate()}`; }
    else if(t['상태']==='퇴실 예정'&&t['퇴실 예정일']){ const d=new Date(t['퇴실 예정일']); targetDateStr=`${d.getMonth()+1}/${d.getDate()}`; }

    // 호실 셀 클릭 → 호실 관리 모달 (행 클릭 차단)
    // 이용료/수납일 셀 클릭 → 수납 모달
    // 나머지 클릭 → 입주자 상세 모달
    return `<tr>
      <td class="res-id" onclick="openTenantModal('${t['입주자 ID']}','view')" style="cursor:pointer;"><span style="font-family:var(--mono);font-size:.78rem;color:var(--text3);">${t['입주자 ID']||'—'}</span></td>
      <td class="clickable-cell" onclick="openRoomManageModal('${t['현재 호실']}')" title="호실 정보"><strong style="color:var(--accent);">${t['현재 호실']||'—'}호</strong></td>
      <td onclick="openTenantModal('${t['입주자 ID']}','view')" style="cursor:pointer;"><strong class="truncate-name">${t['입주자명']||'—'}</strong></td>
      <td class="res-demo" onclick="openTenantModal('${t['입주자 ID']}','view')" style="cursor:pointer;"><span style="color:var(--text2);font-size:.85rem;">${t['국적']||'🇰🇷 대한민국'}</span></td>
      <td class="res-demo" onclick="openTenantModal('${t['입주자 ID']}','view')" style="cursor:pointer;"><span style="color:var(--text2);font-size:.85rem;">${t['성별']||'미상'}</span></td>
      <td class="res-job" onclick="openTenantModal('${t['입주자 ID']}','view')" style="cursor:pointer;"><span class="badge ${jC}">${job}</span></td>
      <td onclick="openTenantModal('${t['입주자 ID']}','view')" style="cursor:pointer;">${cHtml}</td>
      <td class="res-pay" onclick="openTenantModal('${t['입주자 ID']}','view')" style="cursor:pointer;"><span class="badge badge-gray">${t['주 결제 수단']||'—'}</span></td>
      <td onclick="openTenantModal('${t['입주자 ID']}','view')" style="cursor:pointer;color:var(--text3);">${fmtResMoney(depA)}</td>
      <td class="clickable-cell" onclick="if('${t['현재 호실']}') openPaymentModal('${t['현재 호실']}','view')" title="수납 내역"><span style="color:var(--accent);font-weight:600;">${fmtResMoney(t['수납 예정 금액'])}</span></td>
      <td class="clickable-cell" onclick="if('${t['현재 호실']}') openPaymentModal('${t['현재 호실']}','view')" title="수납 내역"><span style="color:var(--accent);">매월 ${dueT}</span></td>
      <td class="res-duration" onclick="openTenantModal('${t['입주자 ID']}','view')" style="cursor:pointer;font-weight:600;color:var(--accent);">${calcDuration(t['입주일'])}</td>
      <td class="res-status" onclick="openTenantModal('${t['입주자 ID']}','view')" style="cursor:pointer;"><span class="badge ${stB}">${t['상태']||'—'}</span></td>
      <td class="res-date" onclick="openTenantModal('${t['입주자 ID']}','view')" style="cursor:pointer;font-weight:600;color:var(--text2);">${targetDateStr}</td>
    </tr>`;
  }).join('');

  ['ID','호실','이름','국적','성별','직업','결제수단','보증금','금액','수납일','거주기간','상태','예정일'].forEach(k=>{
    const el=document.getElementById('sort-t-'+k); if(el) el.textContent=(tenantSortKey===k)?(tenantSortAsc?' ▲':' ▼'):'';
  });
}

function filterTenants() {
  const q=document.getElementById('tenantSearch').value.toLowerCase();
  const fS=document.getElementById('tf-status').value;
  const fG=document.getElementById('tf-gender').value;
  const fJ=document.getElementById('tf-job').value;
  const fP=document.getElementById('tf-pay').value;
  renderTenantTable(gTenants.filter(t=>{
    const isPast=String(t['상태']).trim()==='퇴실';
    if((currentTenTab==='active'&&isPast)||(currentTenTab==='past'&&!isPast)) return false;
    return (!q||[t['입주자명'],t['연락처'],t['현재 호실']].some(v=>String(v).toLowerCase().includes(q)))&&
           (fS==='all'||String(t['상태']).trim()===fS)&&
           (fG==='all'||String(t['성별'])===fG)&&
           (fJ==='all'||String(t['직업']).includes(fJ))&&
           (fP==='all'||String(t['주 결제 수단'])===fP);
  }));
}
function resetTenantFilters() { ['tenantSearch','tf-status','tf-gender','tf-job','tf-pay'].forEach(i=>{ document.getElementById(i).value=i==='tenantSearch'?'':'all'; }); filterTenants(); }

// ============================================================
// 입주자 모달 - 기본 읽기 전용, 수정 버튼으로 편집 전환
// ============================================================
let mContractFilesBase64=[], mExistingContracts=[];

function openTenantModal(id, mode='view') {
  let t=id?gTenants.find(x=>String(x['입주자 ID'])===String(id)):null;
  const isEdit=!!t;
  document.getElementById('modalTitle').textContent=isEdit?(mode==='view'?'상세 정보':'수정'):'신규 등록';
  document.getElementById('m-id').value=isEdit?String(t['입주자 ID']):'';

  // 기본 필드 채우기
  document.getElementById('m-name').value=isEdit?String(t['입주자명']||''):'';
  document.getElementById('m-eng-name').value=isEdit?String(t['영어이름']||''):'';
  document.getElementById('m-status').value=isEdit?String(t['상태']||'거주중').trim():'거주중';

  const cEl=document.getElementById('m-contact-type');
  const tCT=isEdit?String(t['연락 수단']||'휴대전화'):'휴대전화';
  cEl.value=Array.from(cEl.options).some(o=>o.value===tCT)?tCT:'휴대전화';
  document.getElementById('m-phone').value=isEdit?String(t['연락처']||''):'';

  document.getElementById('m-emerg-relation').value=isEdit?String(t['비상연락처_관계']||''):'';
  document.getElementById('m-emerg-phone').value=isEdit?String(t['비상연락처']||''):'';

  if(isEdit&&t['생년월일']) document.getElementById('m-birthdate').value=String(t['생년월일']);
  else document.getElementById('m-birthdate').value='';

  document.getElementById('m-gender').value=isEdit?String(t['성별']||'미상'):'미상';

  const natEl=document.getElementById('m-nationality');
  const tNat=isEdit?String(t['국적']||'🇰🇷 대한민국'):'🇰🇷 대한민국';
  if(Array.from(natEl.options).some(o=>o.value===tNat)) natEl.value=tNat;
  else natEl.value='🇰🇷 대한민국';

  // 직업
  const tJob=isEdit?String(t['직업']||'미상'):'미상';
  updateJobSelect(tJob);

  document.getElementById('m-movein').value=isEdit?String(t['입주일']||''):'';
  document.getElementById('m-moveout').value=isEdit?String(t['퇴실 예정일']||''):'';
  document.getElementById('m-payment-type').value=isEdit?String(t['선납/후납']||'선납'):'선납';
  document.getElementById('m-deposit-yn').value=isEdit?String(t['보증금 여부']||'N'):'N';

  const tDep=isEdit?String(t['보증금 금액']||''):'';
  document.getElementById('m-deposit').value=tDep?Number(tDep.replace(/[^0-9]/g,'')).toLocaleString()+'원':'';
  const tClean=isEdit?String(t['청소비']||''):'';
  document.getElementById('m-cleaning-fee').value=tClean?Number(tClean.replace(/[^0-9]/g,'')).toLocaleString()+'원':'';

  let rawDue=isEdit?String(t['수납 예정일']||'').replace(/일/g,''):'';
  document.getElementById('m-due-day').value=rawDue.includes('말')?'말일':(rawDue?rawDue+'일':'');

  document.getElementById('m-due-amount').value='';
  document.getElementById('m-room-rent-hint').textContent='';

  document.getElementById('m-pay-method').value=isEdit?String(t['주 결제 수단']||'계좌이체'):'계좌이체';
  document.getElementById('m-cash-receipt').value=isEdit?String(t['현금영수증 여부']||'불필요'):'불필요';
  document.getElementById('m-movein-report').value=isEdit?String(t['전입신고']||'미신고'):'미신고';
  document.getElementById('m-memo').value=isEdit?String(t['입주자 특징/메모']||''):'';
  document.getElementById('m-wish-rooms').value=isEdit?String(t['희망 이동 호실']||''):'';
  document.getElementById('m-basic-recipient').value=isEdit?String(t['기초수급자']||'N'):'N';

  // 이용료 표시: 비워두고 placeholder에 호실 기본이용료
  if(isEdit && t['수납 예정 금액'] && Number(t['수납 예정 금액'])>0){
    document.getElementById('m-due-amount').value=Number(t['수납 예정 금액']).toLocaleString()+'원';
  }

  toggleDeposit();
  handleTenantStatusChange();

  mExistingContracts=isEdit&&t['계약서 링크']?String(t['계약서 링크']).split(',').filter(l=>l.trim()):[];
  mContractFilesBase64=[]; document.getElementById('m-contract-file').value=''; renderContractPreview();

  const roomSel=document.getElementById('m-room');
  populateRoomSelect(roomSel,(isEdit&&String(t['상태'])!=='퇴실')?t['현재 호실']:'');
  handleRoomSelectInTenant();

  handleContactTypeChange();
  updateVisitRouteSelect(isEdit ? (t['방문 경로']||'') : '');

  // 읽기 전용 / 편집 모드 전환
  setTenantModalMode(mode, isEdit);
  switchModalTab('basic');
  if(mode==='view'&&isEdit) renderPaymentHealth(t['입주자 ID'],rawDue);
  document.getElementById('tenantModal').style.display='block';
}

function setTenantModalMode(mode, isEdit) {
  const isView = mode==='view';
  // 모든 입력 요소 disabled/enabled
  document.querySelectorAll('#m-tab-basic input, #m-tab-basic select, #m-tab-basic textarea').forEach(el=>{
    if(el.id==='m-contract-file') { el.disabled=isView; return; }
    el.disabled=isView;
  });
  // 버튼 표시
  document.getElementById('m-save-btn').style.display=isView?'none':'block';
  document.getElementById('m-go-edit-btn').style.display=(isView&&isEdit)?'block':'none';
  document.getElementById('m-checkout-btn').style.display=(!isView&&isEdit&&document.getElementById('m-status').value!=='퇴실')?'block':'none';
  document.getElementById('m-delete-btn').style.display=(!isView&&isEdit)?'block':'none';
}

function switchTenantModalToEdit() {
  document.querySelectorAll('#m-tab-basic input, #m-tab-basic select, #m-tab-basic textarea').forEach(el=>{
    el.disabled=false;
  });
  document.getElementById('m-save-btn').style.display='block';
  document.getElementById('m-go-edit-btn').style.display='none';
  const status=document.getElementById('m-status').value;
  document.getElementById('m-checkout-btn').style.display=status!=='퇴실'?'block':'none';
  document.getElementById('m-delete-btn').style.display='block';
  handleContactTypeChange();
}

function closeTenantModal() { document.getElementById('tenantModal').style.display='none'; }

function toggleDeposit() {
  const hasD=document.getElementById('m-deposit-yn').value==='Y';
  document.getElementById('m-deposit-wrap').style.display=hasD?'':'none';
  document.getElementById('m-cleaning-wrap').style.display=hasD?'':'none';
}

function handleTenantStatusChange() {
  try {
    const st = document.getElementById('m-status').value;
    const isTour = st === '투어 대기' || st === '투어 완료';
    
    // 1. 투어 관련 필드 제어 (날짜와 방문 경로 분리된 구조 대응)
    const tourDateFields = document.getElementById('m-tour-date-fields');
    if(tourDateFields) tourDateFields.style.display = isTour ? 'block' : 'none';

    const tourFields = document.getElementById('m-tour-fields'); // 방문 경로
    if(tourFields) { 
      tourFields.style.display = isTour ? 'flex' : 'none'; 
      if(isTour) {
        tourFields.style.flexDirection = 'column';
        tourFields.style.gap = '12px';
        if(typeof refreshWishRoomDropdown === 'function') refreshWishRoomDropdown();
      }
    }
    
    // 2. 재무 및 계약 필드 제어 (투어일 때 숨김)
    const contractFields = document.getElementById('m-contract-fields');
    if(contractFields) contractFields.style.display = isTour ? 'none' : 'flex';
    
    // 3. 퇴실 예정일 표시 제어
    const moveoutWrap = document.getElementById('m-moveout-wrap');
    if(moveoutWrap) moveoutWrap.style.display = (st === '퇴실 예정' || st === '퇴실 완료') ? '' : 'none';
    
    // 4. 보증금 정산 버튼 제어 (기존 입주자이면서 '퇴실 예정'일 때만 노출)
    const idInput = document.getElementById('m-id');
    const id = idInput ? idInput.value : '';
    const settleBtn = document.getElementById('m-deposit-settle-btn');
    if(settleBtn) settleBtn.style.display = (id && st === '퇴실 예정') ? 'block' : 'none';
    
    // 5. 퇴실 처리 버튼 제어
    const saveBtn = document.getElementById('m-save-btn');
    if(saveBtn && saveBtn.style.display !== 'none') {
      const checkoutBtn = document.getElementById('m-checkout-btn');
      if(checkoutBtn) checkoutBtn.style.display = (id && !['퇴실 완료','패스/취소'].includes(st)) ? 'block' : 'none';
    }
  } catch(e) {
    console.error("상태 변경 핸들러 오류:", e);
  }
}
function handleVisitRouteChange() {
  const v = document.getElementById('m-visit-route').value;
  document.getElementById('m-visit-route-custom').style.display = v==='추가' ? 'block' : 'none';
  document.getElementById('m-referral-wrap').style.display = v==='지인추천' ? 'block' : 'none';
}

function addVisitRoute(val) {
  if(!val||!val.trim()) return;
  val = val.trim();
  if(!gVisitRoutes) window.gVisitRoutes = [];
  if(!gVisitRoutes.includes(val)) {
    gVisitRoutes.push(val);
    // 백엔드에 저장
    google.script.run.updateMasterData({type:'route', action:'add', newVal:val});
  }
  // 드롭다운에 반영
  const sel = document.getElementById('m-visit-route');
  const exists = Array.from(sel.options).some(o=>o.value===val);
  if(!exists) {
    const opt = document.createElement('option');
    opt.value=val; opt.textContent=val;
    sel.insertBefore(opt, sel.querySelector('option[value="추가"]'));
  }
  sel.value = val;
  document.getElementById('m-visit-route-custom').style.display='none';
  document.getElementById('m-visit-route-custom').value='';
}

function updateVisitRouteSelect(currentVal) {
  const sel = document.getElementById('m-visit-route');
  if(!sel) return;
  const base = ['','네이버지도','카카오맵','고방','블로그','지인추천','직접방문'];
  const baseLabels = ['선택','네이버지도','카카오맵','고방','블로그','지인추천','직접방문'];
  const extras = (window.gVisitRoutes||[]).filter(r=>!base.includes(r));
  sel.innerHTML = base.map((v,i)=>`<option value="${v}">${baseLabels[i]}</option>`).join('')
    + extras.map(v=>`<option value="${v}">${v}</option>`).join('')
    + '<option value="추가">+ 추가</option>';
  if(currentVal && Array.from(sel.options).some(o=>o.value===currentVal)) sel.value=currentVal;
}

function handleJobChange() {
  document.getElementById('m-job-custom').style.display=document.getElementById('m-job').value==='추가'?'':'none';
}

// 호실 선택 → 기본 이용료 힌트 표시
function handleRoomSelectInTenant() {
  const roomNo=document.getElementById('m-room').value;
  const amtInput=document.getElementById('m-due-amount');
  const hint=document.getElementById('m-room-rent-hint');
  if(!roomNo){ amtInput.placeholder=''; hint.textContent=''; return; }
  const room=gRooms.find(r=>String(r['호실'])===String(roomNo));
  if(room&&room['이용료']){
    const rent=Number(String(room['이용료']).replace(/[^0-9]/g,''));
    amtInput.placeholder=rent.toLocaleString()+'원 (호실 기본값)';
    hint.textContent=`호실 기본 이용료: ${rent.toLocaleString()}원`;
  } else { amtInput.placeholder=''; hint.textContent=''; }
}

let gWishRooms = [];
function refreshWishRoomDropdown() {
  const floor = document.getElementById('m-wish-floor')?.value||'all';
  const wintype = document.getElementById('m-wish-wintype')?.value||'all';
  const roomtype = document.getElementById('m-wish-roomtype')?.value||'all';
  const direction = document.getElementById('m-wish-direction')?.value||'all';
  const sel = document.getElementById('m-wish-select');
  if(!sel) return;

  const cur = gWishRooms.map(w=>String(w));
  const filtered = (gRooms||[]).filter(r=>{
    const no = String(r['호실']||'').trim();
    if(!no || no==='호실') return false;
    if(floor!=='all' && !no.startsWith(floor)) return false;
    if(wintype!=='all' && r['창문 타입']!==wintype) return false;
    if(roomtype!=='all' && r['방 타입']!==roomtype) return false;
    if(direction!=='all' && r['방향']!==direction) return false;
    if(cur.includes(no)) return false; // 이미 선택된 호실 제외
    return true;
  });

  sel.innerHTML = '<option value="">호실 선택...</option>' + filtered.map(r=>{
    const no = String(r['호실']);
    const isV = String(r['공실 여부']||'').toUpperCase()==='Y';
    return `<option value="${no}">${no}호${isV?' ✨':''}</option>`;
  }).join('');
}

function addWishRoom(no) {
  if(!no) return;
  if(gWishRooms.length>=5){ showToast('최대 5개까지 선택 가능합니다.','error'); return; }
  if(gWishRooms.includes(no)) return;
  gWishRooms.push(no); renderWishBadges(); refreshWishRoomDropdown();
}
function removeWishRoom(idx) { gWishRooms.splice(idx,1); renderWishBadges(); refreshWishRoomDropdown(); }
function renderWishBadges() {
  const wrap=document.getElementById('m-wish-badges'); if(!wrap) return;
  wrap.innerHTML=gWishRooms.map((no,i)=>{
    const r=gRooms.find(x=>String(x['호실'])===String(no));
    const isV=r&&String(r['공실 여부']||'').toUpperCase()==='Y';
    return `<span class="wish-badge">${i+1}순위 ${no}호${isV?' ✨':''} <span class="wish-badge-x" onclick="removeWishRoom(${i})">✕</span></span>`;
  }).join('');
  const hidden=document.getElementById('m-wish-rooms');
  if(hidden) hidden.value=gWishRooms.join(', ');
}

function updateJobSelect(currentVal) {
  const sel=document.getElementById('m-job');
  // 기본 직업 목록 + gJobs에 있는 추가 직업
  const baseJobs=['미상','학생','직장인','전문직','자영업','배달','건설근로자','무직'];
  const extraJobs=gJobs.filter(j=>!baseJobs.includes(j));
  let html=baseJobs.map(j=>`<option value="${j}">${j}</option>`).join('');
  if(extraJobs.length) html+=extraJobs.map(j=>`<option value="${j}">${j}</option>`).join('');
  html+='<option value="추가">+ 직접 입력</option>';
  sel.innerHTML=html;
  if(currentVal&&Array.from(sel.options).some(o=>o.value===currentVal)) sel.value=currentVal;
  else sel.value='미상';
  handleJobChange();

  // tf-job 필터도 업데이트
  const tfJob=document.getElementById('tf-job');
  if(tfJob) tfJob.innerHTML='<option value="all">직업 (전체)</option>'+gJobs.map(j=>`<option value="${j}">${j}</option>`).join('');
}

function handleContactTypeChange() {
  const t=document.getElementById('m-contact-type').value;
  const p=document.getElementById('m-phone');
  if(t==='미정'){ p.value='미정'; p.disabled=true; } else { if(p.value==='미정') p.value=''; p.disabled=false; }
}

function populateRoomSelect(sel, tRoom) {
  if(!sel) return;
  const valid=(gRooms||[]).filter(r=>r&&r['호실']&&String(r['호실']).trim()!==''&&String(r['호실']).trim()!=='호실');
  valid.sort((a,b)=>{ const aV=String(a['공실 여부']||'').trim().toUpperCase()==='Y'; const bV=String(b['공실 여부']||'').trim().toUpperCase()==='Y'; if(aV&&!bV) return -1; if(!aV&&bV) return 1; return Number(String(a['호실']).replace(/[^0-9]/g,''))-Number(String(b['호실']).replace(/[^0-9]/g,'')); });
  let html='<option value="">호실 선택</option>';
  valid.forEach(r=>{
    const rN=String(r['호실']).trim(); const isV=String(r['공실 여부']||'').trim().toUpperCase()==='Y'; const isC=(rN===String(tRoom).trim());
    const dis=(!isV&&!isC)?' disabled':''; const st=isC?'':(isV?' (공실✨)':' [사용중]');
    html+=`<option value="${rN}"${isC?' selected':''}${dis}>${rN}호${st}</option>`;
  });
  sel.innerHTML=html;
}

function populateRoomSelectOptional(sel,s) {
  if(!sel) return;
  const v=(gRooms||[]).filter(r=>r['호실']&&String(r['호실']).trim()!==''&&String(r['호실']).trim()!=='호실');
  sel.innerHTML='<option value="">전체/해당없음</option>'+v.map(r=>`<option value="${r['호실']}"${String(r['호실'])===String(s)?' selected':''}>${r['호실']}호</option>`).join('');
}

function previewContract(event) {
  const files=Array.from(event.target.files);
  if(mExistingContracts.length+mContractFilesBase64.length+files.length>3){ showToast('최대 3개까지만 가능.','error'); event.target.value=''; return; }
  files.forEach(file=>{
    const reader=new FileReader();
    reader.onload=e=>{ if(file.type.startsWith('image/')){ const img=new Image(); img.onload=()=>{ const canvas=document.createElement('canvas'); let w=img.width,h=img.height; if(w>1200||h>1200){ if(w>h){h*=1200/w;w=1200;}else{w*=1200/h;h=1200;} } canvas.width=w; canvas.height=h; canvas.getContext('2d').drawImage(img,0,0,w,h); mContractFilesBase64.push({name:file.name,mimeType:'image/jpeg',data:canvas.toDataURL('image/jpeg',0.8).split(',')[1]}); renderContractPreview(); }; img.src=e.target.result; } else { mContractFilesBase64.push({name:file.name,mimeType:file.type,data:e.target.result.split(',')[1]}); renderContractPreview(); } };
    reader.readAsDataURL(file);
  }); event.target.value='';
}
function removeContractExisting(i){ mExistingContracts.splice(i,1); renderContractPreview(); }
function removeContractFile(i){ mContractFilesBase64.splice(i,1); renderContractPreview(); }
function renderContractPreview() {
  let html='';
  mExistingContracts.forEach((u,i)=>html+=`<div class="file-item">🔗 기존 ${i+1} <span onclick="removeContractExisting(${i})" style="cursor:pointer;color:var(--red);margin-left:4px;font-weight:bold;">✕</span></div>`);
  mContractFilesBase64.forEach((f,i)=>html+=`<div class="file-item">📄 ${f.name.substring(0,10)}... <span onclick="removeContractFile(${i})" style="cursor:pointer;color:var(--red);margin-left:4px;font-weight:bold;">✕</span></div>`);
  document.getElementById('m-contract-preview').innerHTML=html;
}

function saveTenant() {
  const id=document.getElementById('m-id').value;
  const cT=document.getElementById('m-contact-type').value;
  const cD=document.getElementById('m-phone').value.trim();
  if(cT!=='미정'&&!cD) return showToast('연락처 필수','error');

  let job=document.getElementById('m-job').value;
  if(job==='추가'){
    job=document.getElementById('m-job-custom').value.trim();
    if(!job) return showToast('직업을 입력해주세요.','error');
    // 새 직업을 gJobs에 추가
    if(!gJobs.includes(job)) gJobs.push(job);
  }

  let dueAmtStr=document.getElementById('m-due-amount').value;
  if(!dueAmtStr||dueAmtStr.replace(/[^0-9]/g,'')==='0'){
    const ph=document.getElementById('m-due-amount').placeholder;
    dueAmtStr=ph?ph:'0';
  }
  const expectedAmt=Number(dueAmtStr.replace(/[^0-9]/g,''))||0;

  const rawDueDay=document.getElementById('m-due-day').value.replace(/일/g,'').trim();
  const dueDay=rawDueDay.includes('말')?'말일':rawDueDay;

  const pay={
    '입주자 ID':id, 입주자명:document.getElementById('m-name').value, '영어이름':document.getElementById('m-eng-name').value,
    연락수단:cT, 연락처:cT==='미정'?'미정':cD, 현재호실:document.getElementById('m-room').value,
    입주일:document.getElementById('m-movein').value, '선납/후납':document.getElementById('m-payment-type').value,
    '보증금 여부':document.getElementById('m-deposit-yn').value,
    '보증금 금액':Number(document.getElementById('m-deposit').value.replace(/[^0-9]/g,''))||0,
    '청소비':Number(document.getElementById('m-cleaning-fee').value.replace(/[^0-9]/g,''))||0,
    '수납 예정일':dueDay, '수납 예정 금액':expectedAmt,
    '주 결제 수단':document.getElementById('m-pay-method').value,
    '현금영수증 여부':document.getElementById('m-cash-receipt').value,
    '입주자 특징/메모':document.getElementById('m-memo').value,
    상태:document.getElementById('m-status').value,
    국적:document.getElementById('m-nationality').value,
    성별:document.getElementById('m-gender').value,
    직업:job,
    '희망 이동 호실':document.getElementById('m-wish-rooms').value,
    '전입신고':document.getElementById('m-movein-report').value,
    '퇴실 예정일':document.getElementById('m-moveout').value,
    '계약서 링크':mExistingContracts.join(','),
    '생년월일':document.getElementById('m-birthdate').value,
    '비상연락처_관계':document.getElementById('m-emerg-relation').value,
    '비상연락처':document.getElementById('m-emerg-phone').value,
    '기초수급자':document.getElementById('m-basic-recipient').value
  };

  if(!pay.입주자명||(pay.상태!=='퇴실'&&!pay.현재호실)) return showToast('이름과 호실 필수','error');
  showSpinner('저장 중...');

  if(mContractFilesBase64.length>0){
    google.script.run.withSuccessHandler(r=>{ if(r.ok){ pay['계약서 링크']=[...mExistingContracts,...r.urls].join(','); executeSaveTenant(pay,id); } else { hideSpinner(); showToast('업로드 실패','error'); } }).uploadTenantContract(id||'NEW',mContractFilesBase64);
  } else { executeSaveTenant(pay,id); }
}

function executeSaveTenant(p, id) {
  if (isSubmitting) return showToast('처리 중입니다.', 'error');
  isSubmitting = true;
  google.script.run
    .withSuccessHandler(r => {
      isSubmitting = false;
      closeTenantModal();
      safeLoadAll();
    })
    .withFailureHandler(e => {
      hideSpinner();
      isSubmitting = false;
      showToast(e.message, 'error');
    })
    [id ? 'updateTenant' : 'addTenant'](p);
}

function executeCheckout() {
  const id = document.getElementById('m-id').value;
  if (!id || !confirm('즉시 퇴실 처리하시겠습니까?')) return;
  if (isSubmitting) return showToast('처리 중입니다.', 'error');
  isSubmitting = true;
  showSpinner('처리 중...');
  google.script.run
    .withSuccessHandler(r => {
      isSubmitting = false;
      closeTenantModal();
      safeLoadAll();
    })
    .withFailureHandler(e => {
      hideSpinner();
      isSubmitting = false;
      showToast(e.message, 'error');
    })
    .backendCheckoutTenant(id);
}

function executeDeleteTenant() {
  const id = document.getElementById('m-id').value;
  if (!id || !confirm('영구 삭제하시겠습니까?')) return;
  if (isSubmitting) return showToast('처리 중입니다.', 'error');
  isSubmitting = true;
  showSpinner('삭제 중...');
  google.script.run
    .withSuccessHandler(r => {
      isSubmitting = false;
      closeTenantModal();
      safeLoadAll();
    })
    .withFailureHandler(e => {
      hideSpinner();
      isSubmitting = false;
      showToast(e.message, 'error');
    })
    .backendDeleteTenant(id);
}

function switchModalTab(tab) {
  ['basic','history'].forEach(t=>{ document.getElementById('m-tab-btn-'+t).classList.remove('active'); document.getElementById('m-tab-'+t).style.display='none'; });
  document.getElementById('m-tab-btn-'+tab).classList.add('active'); document.getElementById('m-tab-'+tab).style.display='flex';
}

function renderPaymentHealth(tId,due) {
  google.script.run.withSuccessHandler(allPmts=>{
    const hE=document.getElementById('m-history-list'); const ph=document.getElementById('m-payment-health');
    const pmts=(allPmts||[]).filter(p=>String(p['입주자 ID'])===String(tId));
    if(!pmts.length){ hE.innerHTML='기록 없음'; ph.innerHTML='기록 없음'; document.getElementById('m-gemini-tenant-text').textContent='분석 데이터 부족'; return; }
    let tDf=0;
    const bs=pmts.sort((a,b)=>new Date(b['수납일'])-new Date(a['수납일'])).map(p=>{
      const act=new Date(p['수납일']); const [y,m]=String(p['수납 대상 월']).split('-');
      const dN=parseInt(String(due).replace(/[^0-9]/g,''));
      const exp=(String(due).includes('말')||dN>=31)?new Date(y,m,0):new Date(y,m-1,dN||1);
      const df=Math.round((act-exp)/86400000); tDf+=df;
      return `<span class="badge ${df<=0?'badge-green':'badge-red'}">${p['수납 대상 월']}: ${df===0?'당일':(df>0?`D+${df}`:`D${df}`)}</span>`;
    });
    const avg=(tDf/pmts.length).toFixed(1);
    const aT=avg<=0?`<span style="color:var(--green)">평균 ${Math.abs(avg)}일 조기 납부</span>`:`<span style="color:var(--red)">평균 ${avg}일 지연 납부</span>`;
    ph.innerHTML=(bs.join('')||'기록 없음')+`<div style="width:100%;margin-top:10px;font-weight:600;">📈 ${aT}</div>`;
    hE.innerHTML=pmts.map(p=>`<div>[${p['수납 대상 월']}] ${p['수납일']} / ${fmtMoney(p['실제 수납 금액'])} 수납</div>`).join('');
    document.getElementById('m-gemini-tenant-text').textContent=`이 입주자는 총 ${pmts.length}회의 수납 이력이 있으며, ${avg<=0?'조기':'지연'} 납부 패턴입니다.`;
  }).getPayments('');
}

function checkRoomTransferAlerts() {
  if(!gRooms||!gTenants) return;
  const aB=document.getElementById('transferAlertBox'); if(!aB) return;
  const vN=gRooms.filter(r=>String(r['공실 여부']).trim().toUpperCase()==='Y').map(r=>String(r['호실']).replace(/[^0-9]/g,''));
  const rMap={};
  gTenants.filter(t=>String(t['상태']).trim()==='거주중'&&t['희망 이동 호실']).forEach(t=>{
    const w=String(t['희망 이동 호실']).split(',').map(s=>s.trim().replace(/[^0-9]/g,''));
    w.forEach(m=>{ if(m&&vN.includes(m)){ if(!rMap[m]) rMap[m]=[]; rMap[m].push(`<strong>${t['현재 호실']}호 ${t['입주자명']}님</strong>`); } });
  });
  const alerts=Object.keys(rMap).map(no=>`✨ ${rMap[no].join(', ')}이(가) 희망하신 <strong>${no}호</strong>가 공실!`);
  if(alerts.length){ aB.innerHTML=alerts.map(a=>`<div class="gemini-box" style="margin-bottom:12px;border-left:4px solid var(--yellow);background:rgba(255,184,48,.05);padding:14px 18px;"><div style="font-size:.9rem;color:var(--text);">${a}</div></div>`).join(''); aB.style.display='block'; } else { aB.style.display='none'; }
}

// ============================================================
// 호실 관리 - 입주자 이름+연락처 표시, 클릭 시 입주자 모달
// ============================================================
function renderRoomManageGrid(rooms) {
  const grid=document.getElementById('roomManageGrid');
  if(!rooms||!rooms.length){ grid.innerHTML='<div class="empty-state" style="grid-column:1/-1;">없음</div>'; return; }

  grid.innerHTML=rooms.sort((a,b)=>Number(String(a['호실']).replace(/[^0-9]/g,''))-Number(String(b['호실']).replace(/[^0-9]/g,''))).map(r=>{
    const cT=gTenants?gTenants.find(t=>String(t['현재 호실'])===String(r['호실'])&&['거주중','입실 예정','퇴실 예정'].includes(String(t['상태']).trim())):null;
    const isV=!cT&&String(r['공실 여부']).toUpperCase()==='Y';

    let sB=isV?'<span class="badge badge-green">공실</span>':'<span class="badge badge-gray">거주중</span>';
    let tName='—', tId='', tPhone='—', tContact='휴대전화', tRent='—';

    if(cT){
      const st=String(cT['상태']).trim();
      sB=st==='입실 예정'?'<span class="badge badge-blue">입실 예정</span>':(st==='퇴실 예정'?'<span class="badge badge-red">퇴실 예정</span>':'<span class="badge badge-gray">거주중</span>');
      tName=cT['입주자명']||'—'; tId=cT['입주자 ID']||''; tPhone=cT['연락처']||'—'; tContact=cT['연락 수단']||'휴대전화';
      tRent=cT['수납 예정 금액']&&Number(cT['수납 예정 금액'])>0?fmtResMoney(cT['수납 예정 금액']):(r['이용료']?fmtResMoney(r['이용료']):'—');
    } else if(!isV){
      tName=r['현 입주자명']||'—'; tPhone=r['현 입주자 연락처']||'—'; tContact=r['현 입주자 연락 수단']||'휴대전화';
      tRent=r['이용료']?fmtResMoney(r['이용료']):'—';
    } else {
      tRent=r['이용료']?fmtResMoney(r['이용료']):'—';
    }

    // 입주자 클릭 HTML
    const tenantClickAttr=tId?`onclick="event.stopPropagation(); openTenantModal('${tId}','view')" style="cursor:pointer;" title="입주자 상세 정보"`:'';
    const tenantNameHtml=tId?`<span ${tenantClickAttr} style="color:var(--accent);font-weight:600;">${tName}</span>`:`<span style="color:var(--text2);">${tName}</span>`;
    const tenantPhoneHtml=tId?`<span ${tenantClickAttr} style="display:flex;align-items:center;">${getContactIconHtml(tContact)}<span style="color:var(--accent);">${tPhone}</span></span>`:`<span>${tPhone}</span>`;

    let pH='';
    if(r['사진 링크']){ pH=`<div style="height:120px;border-radius:10px;margin-bottom:12px;background:url('${r['사진 링크'].split(',')[0].trim()}') center/cover no-repeat;border:1px solid var(--border);"></div>`; }
    else { pH=`<div style="height:120px;border-radius:10px;margin-bottom:12px;background:var(--bg);border:1px dashed var(--border);display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:.85rem;">사진 없음</div>`; }

    return `<div class="room-card ${isV?'vacant':''}" data-floor="${String(r['호실']).charAt(0)}" data-status="${isV?'vacant':'occupied'}" data-type="${r['방 타입']||''}" onclick="openRoomManageModal('${r['호실']}')">
      ${pH}
      <div class="flex justify-between items-center" style="margin-bottom:10px;"><h3 style="font-size:1.2rem;font-weight:800;color:var(--accent);">${r['호실']}호</h3>${sB}</div>
      <div style="font-size:.85rem;color:var(--text2);margin-bottom:12px;">${r['방 타입']||'—'} ${r['창문 타입']?'/ '+r['창문 타입']:''}</div>
      <div style="border-bottom:1px dashed var(--border);padding-bottom:10px;margin-bottom:10px;">
        <div class="flex justify-between" style="margin-bottom:4px;"><span style="font-size:.8rem;color:var(--text3);">수납금액</span><strong style="color:var(--red);">${tRent}</strong></div>
      </div>
      <div class="flex flex-col gap-8" style="font-size:.85rem;">
        <div class="flex items-center gap-8"><span style="color:var(--text3);width:45px;flex-shrink:0;">입주자</span>${tenantNameHtml}</div>
        <div class="flex items-center gap-8"><span style="color:var(--text3);width:45px;flex-shrink:0;">연락처</span>${isV?'<span style="color:var(--text3);">—</span>':tenantPhoneHtml}</div>
      </div>
    </div>`;
  }).join('');
  applyRoomManageFilters();
}

function applyRoomManageFilters() {
  const fFl=document.getElementById('rmf-floor').value; const fSt=document.getElementById('rmf-status').value; const fTy=document.getElementById('rmf-type').value;
  document.querySelectorAll('#roomManageGrid .room-card').forEach(c=>{ let s=true; if(fFl!=='all'&&c.dataset.floor!==fFl) s=false; if(fSt!=='all'&&c.dataset.status!==fSt) s=false; if(fTy!=='all'&&!(c.dataset.type||'').includes(fTy)) s=false; c.style.display=s?'':'none'; });
}
function resetRoomManageFilters() { document.getElementById('rmf-floor').value='all'; document.getElementById('rmf-status').value='all'; document.getElementById('rmf-type').value='all'; applyRoomManageFilters(); }
function initManageRoomFilter() { document.querySelectorAll('#manageRoomFilter .filter-select').forEach(s=>s.addEventListener('change',applyRoomManageFilters)); }

// ============================================================
// 호실 정보 수정 모달
// ============================================================
let rmFilesBase64=[], rmExistingPhotos=[];

function openRoomManageModal(no) {
  const r=gRooms.find(x=>String(x['호실'])===String(no)); if(!r) return;
  const cT=gTenants?gTenants.find(t=>String(t['현재 호실'])===String(r['호실'])&&['거주중','입실 예정','퇴실 예정'].includes(String(t['상태']).trim())):null;
  const rA=cT&&cT['수납 예정 금액']&&Number(cT['수납 예정 금액'])>0?cT['수납 예정 금액']:(r['이용료']||'');
  document.getElementById('rm-no').value=r['호실'];
  document.getElementById('rm-rent').value=rA?Number(String(rA).replace(/[^0-9]/g,'')).toLocaleString()+'원':'';
  document.getElementById('rm-type').value=r['방 타입']||'';
  document.getElementById('rm-window').value=r['창문 타입']||'';
  document.getElementById('rm-direction').value=r['방향']||'';
  document.getElementById('rm-area-py').value=r['면적(평)']||'';
  document.getElementById('rm-area-m2').value=r['면적(m2)']||'';
  document.getElementById('rm-memo').value=r['방 컨디션 메모']||'';
  rmExistingPhotos=r['사진 링크']?r['사진 링크'].split(',').map(s=>s.trim()).filter(s=>s):[];
  rmFilesBase64=[]; document.getElementById('rm-photos').value='';
  renderRmFilePreview();
  document.getElementById('roomManageModal').style.display='block';
}
function closeRoomManageModal() { document.getElementById('roomManageModal').style.display='none'; }

function removeRmExisting(i){ rmExistingPhotos.splice(i,1); renderRmFilePreview(); }
function removeRmFile(i){ rmFilesBase64.splice(i,1); renderRmFilePreview(); }
function renderRmFilePreview() {
  let h='';
  rmExistingPhotos.forEach((u,i)=>{
    const name=u.split('/').pop().split('?')[0].substring(0,20)||`사진 ${i+1}`;
    h+=`<div class="file-item">🖼️ ${name} <a href="${u}" target="_blank" style="color:var(--accent);margin-left:4px;">보기</a> <span onclick="removeRmExisting(${i})" style="cursor:pointer;color:var(--red);margin-left:6px;font-weight:bold;">✕</span></div>`;
  });
  rmFilesBase64.forEach((f,i)=>{
    h+=`<div class="file-item">🖼️ ${f.name.substring(0,20)} <span style="color:var(--text3);font-size:.75rem;">(새 파일)</span> <span onclick="removeRmFile(${i})" style="cursor:pointer;color:var(--red);margin-left:6px;font-weight:bold;">✕</span></div>`;
  });
  document.getElementById('rm-photo-preview').innerHTML=h||'<span style="color:var(--text3);font-size:.85rem;">업로드된 사진 없음</span>';
}
function previewPhotos(e) {
  Array.from(e.target.files).forEach(f=>{ const r=new FileReader(); r.onload=ev=>{ const img=new Image(); img.onload=()=>{ const canvas=document.createElement('canvas'); let w=img.width,h=img.height; if(w>1200||h>1200){ if(w>h){h*=1200/w;w=1200;}else{w*=1200/h;h=1200;} } canvas.width=w; canvas.height=h; canvas.getContext('2d').drawImage(img,0,0,w,h); rmFilesBase64.push({name:f.name,mimeType:'image/jpeg',data:canvas.toDataURL('image/jpeg',0.8).split(',')[1]}); renderRmFilePreview(); }; img.src=ev.target.result; }; r.readAsDataURL(f); }); e.target.value='';
}
function saveRoomManage() {
  const rN=document.getElementById('rm-no').value; const ty=document.getElementById('rm-type').value; const mm=document.getElementById('rm-memo').value; const rt=document.getElementById('rm-rent').value.replace(/[^0-9]/g,'');
  const wT=document.getElementById('rm-window').value; const dR=document.getElementById('rm-direction').value; const pY=document.getElementById('rm-area-py').value; const m2=document.getElementById('rm-area-m2').value;
  const p={호실:rN,'방 타입':ty,'방 컨디션 메모':mm,이용료:Number(rt)||0,'창문 타입':wT,'방향':dR,'면적(평)':pY,'면적(m2)':m2};
  showSpinner('저장 중...');
  if(rmFilesBase64.length>0){ google.script.run.withSuccessHandler(res=>{ if(res.ok){ p['사진 링크']=[...rmExistingPhotos,...res.urls].join(','); google.script.run.withSuccessHandler(()=>{ closeRoomManageModal(); loadAll(); }).updateRoomManageData(p); } }).uploadRoomPhotos(rN,rmFilesBase64); }
  else { p['사진 링크']=rmExistingPhotos.join(','); google.script.run.withSuccessHandler(()=>{ closeRoomManageModal(); loadAll(); }).updateRoomManageData(p); }
}

// ============================================================
// 자산 관리
// ============================================================
function renderFinanceTable() {
  const tbody=document.getElementById('financeBody'); if(!gFinance.length){ tbody.innerHTML='<tr><td colspan="6" class="empty-state">등록된 자산이 없습니다.</td></tr>'; return; }
  let html='';
  ['은행계좌','신용카드','체크카드'].forEach(type=>{
    const items=gFinance.filter(f=>f['분류']===type);
    if(items.length){ html+=`<tr style="background:var(--bg);"><td colspan="6" style="font-weight:700;color:var(--text2);font-size:.8rem;">[${type}]</td></tr>`; items.forEach(f=>{ const apd=(f['분류']==='신용카드'&&f['결제일'])?getActualPaydayHtml(gm(),f['결제일']):(f['결제일']||'—'); const co=f['이용종료일']?`<br><span style="font-size:.75rem;color:var(--text3);">기준일: 매월 ${f['이용종료일']}</span>`:''; html+=`<tr><td><span class="badge badge-gray">${f['분류']}</span></td><td><div style="display:flex;align-items:center;">${getFinanceLogoHtml(f['금융사명'])}<strong>${f['금융사명']}</strong></div></td><td>${f['별칭']||'—'} <span style="color:var(--text3);">${f['식별번호']?`(${f['식별번호']})`:''}$</span></td><td>${f['소유주']||'—'}</td><td>${apd}${co}</td><td><button class="btn btn-secondary btn-sm" onclick="editFinance('${f['ID']}')">수정</button> <button class="btn btn-danger btn-sm" onclick="delFinance('${f['ID']}')">삭제</button></td></tr>`; }); }
  }); tbody.innerHTML=html;
}
function editFinance(id) {
  const f=gFinance.find(x=>String(x['ID'])===String(id)); if(!f) return;
  document.getElementById('f-id').value=f['ID']; document.getElementById('f-type').value=f['분류']; handleFinanceType();
  document.getElementById('f-brand').value=f['금융사명']; document.getElementById('f-alias').value=f['별칭']||''; document.getElementById('f-number').value=f['식별번호']||''; document.getElementById('f-owner').value=f['소유주']||''; document.getElementById('f-payday').value=f['결제일']||''; document.getElementById('f-cutoff').value=f['이용종료일']||''; document.getElementById('f-linked-account').value=f['연결계좌']||'';
}
function clearFinanceForm() { ['f-id','f-alias','f-number','f-owner','f-payday','f-cutoff'].forEach(id=>document.getElementById(id).value=''); }
function saveFinance() {
  const id=document.getElementById('f-id').value; const brand=document.getElementById('f-brand').value; if(!brand) return showToast('금융사명 필수','error');
  const p={id,type:document.getElementById('f-type').value,brand,alias:document.getElementById('f-alias').value,number:document.getElementById('f-number').value,payDay:document.getElementById('f-payday').value,owner:document.getElementById('f-owner').value,cutOffDay:document.getElementById('f-cutoff').value,linkedAccount:document.getElementById('f-linked-account').value};
  showSpinner('저장 중...'); google.script.run.withSuccessHandler(r=>{ hideSpinner(); if(r.ok){ showToast('완료'); clearFinanceForm(); loadAll(); } })[id?'updateFinancialAccount':'saveFinancialAccount'](p);
}
function delFinance(id) { if(!confirm('정말 삭제하시겠습니까?')) return; showSpinner('삭제 중...'); google.script.run.withSuccessHandler(r=>loadAll()).deleteFinancialAccount(id); }
function handleFinanceType() {
  const t=document.getElementById('f-type').value; const s=document.getElementById('f-brand'); s.innerHTML='';
  (t.includes('카드')?cardList:bankList).forEach(b=>s.innerHTML+=`<option value="${b}">${b}</option>`);
  document.getElementById('f-payday-wrap').style.display=t==='신용카드'?'':'none';
  document.getElementById('f-cutoff-wrap').style.display=t==='신용카드'?'':'none';
  document.getElementById('f-linked-wrap').style.display=t==='신용카드'?'':'none';
  if(t==='신용카드'){ const l=document.getElementById('f-linked-account'); l.innerHTML='<option value="">선택 안함</option>'; gFinance.filter(f=>f['분류']==='은행계좌').forEach(f=>l.innerHTML+=`<option value="${f['금융사명']} ${f['별칭']?`(${f['별칭']})`:'  '}">${f['금융사명']} ${f['별칭']?`(${f['별칭']})`:''}</option>`); }
}

// ============================================================
// 지출 관리
// ============================================================
function updateCategorySelect() {
  const sel=document.getElementById('expCategory'); const cVal=sel.value; let html='<option value="">선택</option>'; gCategories.forEach(c=>html+=`<option value="${c}">${c}</option>`); html+='<option value="추가">+ 추가</option>'; sel.innerHTML=html;
  if(cVal&&Array.from(sel.options).some(o=>o.value===cVal)) sel.value=cVal; else { sel.value=''; document.getElementById('expCategoryCustom').style.display='none'; }
  const ef=document.getElementById('ef-category'); if(ef) ef.innerHTML='<option value="all">카테고리 (전체)</option>'+gCategories.map(c=>`<option value="${c}">${c}</option>`).join('');
}
function handleCatChange() { document.getElementById('expCategoryCustom').style.display=document.getElementById('expCategory').value==='추가'?'':'none'; }
function updateFinanceSelect() {
  const s=document.getElementById('expFinanceSelect'); const m=document.getElementById('expPayMethod').value; s.innerHTML='<option value="">선택 안함</option>';
  gFinance.forEach(f=>{ if((m==='신용카드'&&f['분류']!=='신용카드')||(m==='체크카드'&&f['분류']!=='체크카드')||(m==='계좌이체'&&f['분류']!=='은행계좌')) return; s.innerHTML+=`<option value="${f['금융사명']} ${f['별칭']?`(${f['별칭']})`:''}">${f['금융사명']} ${f['별칭']?`(${f['별칭']})`:''}</option>`; });
  const ef=document.getElementById('ef-finance'); if(ef) ef.innerHTML='<option value="all">금융사 (전체)</option>'+gFinance.map(f=>`<option value="${f['금융사명']} ${f['별칭']?`(${f['별칭']})`:''}">${f['금융사명']} ${f['별칭']?`(${f['별칭']})`:''}</option>`).join('');
}
function handlePayMethodChange() { document.getElementById('expFinanceWrap').style.display=document.getElementById('expPayMethod').value==='현금/기타'?'none':''; updateFinanceSelect(); }

let expFilesBase64=[], expExistingReceipts=[];
function removeExpExisting(i){ expExistingReceipts.splice(i,1); renderExpFilePreview(); }
function removeExpFile(i){ expFilesBase64.splice(i,1); renderExpFilePreview(); }
function renderExpFilePreview() {
  let h='';
  expExistingReceipts.forEach((u,i)=>h+=`<div class="file-item">🔗 기존 ${i+1} <span onclick="removeExpExisting(${i})" style="cursor:pointer;color:var(--red);margin-left:4px;font-weight:bold;">✕</span></div>`);
  expFilesBase64.forEach((f,i)=>h+=`<div class="file-item">📄 ${f.name.substring(0,10)}... <span onclick="removeExpFile(${i})" style="cursor:pointer;color:var(--red);margin-left:4px;font-weight:bold;">✕</span></div>`);
  document.getElementById('expReceiptPreview').innerHTML=h;
}
function clearExpenseForm() {
  document.getElementById('expId').value=''; ['expAmount','expDetail','expMemo','expCategoryCustom','expReceipts'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('expDate').value=toDateInput(new Date()); document.getElementById('expCategory').value=''; document.getElementById('expRoom').value=''; expFilesBase64=[]; expExistingReceipts=[]; renderExpFilePreview();
}
function previewReceipts(e) {
  const files=Array.from(e.target.files); if(expExistingReceipts.length+expFilesBase64.length+files.length>10){ showToast('최대 10개','error'); e.target.value=''; return; }
  files.forEach(file=>{ const r=new FileReader(); r.onload=ev=>{ if(file.type.startsWith('image/')){ const img=new Image(); img.onload=()=>{ const canvas=document.createElement('canvas'); let w=img.width,h=img.height; if(w>1200||h>1200){if(w>h){h*=1200/w;w=1200;}else{w*=1200/h;h=1200;}} canvas.width=w; canvas.height=h; canvas.getContext('2d').drawImage(img,0,0,w,h); expFilesBase64.push({name:file.name,mimeType:'image/jpeg',data:canvas.toDataURL('image/jpeg',0.8).split(',')[1]}); renderExpFilePreview(); }; img.src=ev.target.result; } else { expFilesBase64.push({name:file.name,mimeType:file.type,data:ev.target.result.split(',')[1]}); renderExpFilePreview(); } }; r.readAsDataURL(file); }); e.target.value='';
}
function openExpenseModal(id) {
  clearExpenseForm(); const e=id?gExpenses.find(x=>String(x['지출 ID'])===String(id)):null; const isE=!!e;
  document.getElementById('expModalTitle').textContent=isE?'수정':'추가'; document.getElementById('exp-delete-btn').style.display=isE?'block':'none';
  if(isE){ document.getElementById('expId').value=e['지출 ID']; document.getElementById('expDate').value=e['지출일']||''; document.getElementById('expAmount').value=Number(String(e['지출금액']).replace(/[^0-9]/g,'')||0).toLocaleString()+'원'; document.getElementById('expPayMethod').value=e['결제수단']||'계좌이체'; handlePayMethodChange(); document.getElementById('expFinanceSelect').value=e['금융사명']||''; const cSel=document.getElementById('expCategory'); if(Array.from(cSel.options).some(o=>o.value===e['지출 카테고리'])){ cSel.value=e['지출 카테고리']; } else { cSel.value='추가'; document.getElementById('expCategoryCustom').style.display=''; document.getElementById('expCategoryCustom').value=e['지출 카테고리']||''; } document.getElementById('expRoom').value=e['지출 대상 호실 (해당 시)']||''; document.getElementById('expDetail').value=e['세부 항목명']||''; document.getElementById('expMemo').value=e['메모']||''; expExistingReceipts=e['증빙자료링크']?String(e['증빙자료링크']).split(',').filter(l=>l.trim()):[]; renderExpFilePreview(); }
  document.getElementById('expenseModal').style.display='block';
}
function closeExpenseModal() { document.getElementById('expenseModal').style.display='none'; }
function deleteExpenseRecord() {
  const id = document.getElementById('expId').value;
  if (!confirm('정말 삭제하시겠습니까?')) return;
  if (isSubmitting) return showToast('처리 중입니다.', 'error');
  isSubmitting = true;
  showSpinner('삭제 중입니다');
  google.script.run
    .withSuccessHandler(r => {
      isSubmitting = false;
      closeExpenseModal();
      safeLoadAll();
    })
    .withFailureHandler(e => {
      hideSpinner();
      isSubmitting = false;
      showToast('삭제 실패: ' + e.message, 'error');
    })
    .deleteExpense(id);
}

function saveExpenseToSheet(p) {
  google.script.run
    .withSuccessHandler(r => {
      hideSpinner();
      isSubmitting = false;
      if (r.ok) {
        showToast('완료했습니다');
        clearExpenseForm();
        closeExpenseModal();
        safeLoadAll();
      }
    })
    .withFailureHandler(e => {
      hideSpinner();
      isSubmitting = false;
      showToast('저장 실패: ' + e.message, 'error');
    })
    .saveExpense(p);
}
let expSortKey='날짜', expSortAsc=false;
function sortExpenseGrid(k) { if(expSortKey===k) expSortAsc=!expSortAsc; else { expSortKey=k; expSortAsc=false; } filterExpenses(); }
function filterExpenses() { renderExpenseTable(); }
function resetExpenseFilters() { document.getElementById('ef-method').value='all'; document.getElementById('ef-finance').value='all'; document.getElementById('ef-category').value='all'; renderExpenseTable(); }
function renderExpenseTable() { const tbody=document.getElementById('expenseBody'); const cM=gm(); const fM=document.getElementById('ef-method').value; const fF=document.getElementById('ef-finance').value; const fC=document.getElementById('ef-category').value; let fD=gExpenses.filter(e=>String(e['지출일']).startsWith(cM)); if(fM!=='all') fD=fD.filter(e=>String(e['결제수단'])===fM); if(fF!=='all') fD=fD.filter(e=>String(e['금융사명'])===fF); if(fC!=='all') fD=fD.filter(e=>String(e['지출 카테고리'])===fC); let tot=0; fD.forEach(e=>tot+=(Number(String(e['지출금액']).replace(/[^0-9]/g,''))||0)); document.getElementById('expenseTotalAmount').textContent=`합계: ${fmtMoney(tot)}`; if(!fD.length){ tbody.innerHTML='<tr><td colspan="6" class="empty-state">내역 없음</td></tr>'; return; } 
fD.sort((a,b)=>{
  if(expSortKey==='날짜'){
    const dd=a['지출일'].localeCompare(b['지출일']);
    if(dd!==0) return expSortAsc?dd:-dd;
    return expSortAsc?String(a['지출 ID']).localeCompare(String(b['지출 ID'])):String(b['지출 ID']).localeCompare(String(a['지출 ID']));
  }
  let vA,vB;
  if(expSortKey==='금액'){vA=Number(String(a['지출금액']).replace(/[^0-9]/g,''))||0;vB=Number(String(b['지출금액']).replace(/[^0-9]/g,''))||0;}
  else if(expSortKey==='결제수단'){vA=a['결제수단']||'';vB=b['결제수단']||'';}
  else if(expSortKey==='항목'){vA=a['지출 카테고리']||'';vB=b['지출 카테고리']||'';}
  else{vA=a['지출일'];vB=b['지출일'];}
  if(vA<vB) return expSortAsc?-1:1;
  if(vA>vB) return expSortAsc?1:-1;
  return 0;
});
['날짜','결제수단','항목','금액'].forEach(k=>{ const el=document.getElementById('sort-e-'+k); 
if(el) el.textContent=(expSortKey===k)?(expSortAsc?' ▲':' ▼'):''; }); tbody.innerHTML=fD.map(e=>`<tr onclick="openExpenseModal('${e['지출 ID']}')" style="cursor:pointer;"><td>${e['지출일']}</td><td><span class="badge badge-gray">${e['결제수단']||'—'}</span></td><td><span class="badge badge-blue">${e['지출 카테고리']}</span> ${e['세부 항목명']||'—'}</td><td style="color:var(--red);font-weight:600;">${fmtResMoney(e['지출금액'])}</td><td><span class="badge ${e['정산상태']==='미정산'?'badge-red':'badge-green'}">${e['정산상태']||'완료'}</span></td><td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openExpenseModal('${e['지출 ID']}')">관리</button></td></tr>`).join(''); applyColVisibility('expenseTable'); }

// ============================================================
// 수익 관리
// ============================================================
let incSortKey='날짜', incSortAsc=false;
function sortIncomeGrid(k) { if(incSortKey===k) incSortAsc=!incSortAsc; else { incSortKey=k; incSortAsc=false; } filterIncomes(); }
function updateIncCategorySelect() {
  const sel=document.getElementById('incCategory'); const cVal=sel.value; let html='<option value="">선택</option>'; gIncomeCategories.forEach(c=>html+=`<option value="${c}">${c}</option>`); html+='<option value="추가">+ 추가</option>'; sel.innerHTML=html;
  if(cVal&&Array.from(sel.options).some(o=>o.value===cVal)) sel.value=cVal; else { sel.value=''; document.getElementById('incCategoryCustom').style.display='none'; }
  const ic=document.getElementById('if-category'); if(ic) ic.innerHTML='<option value="all">카테고리 (전체)</option>'+gIncomeCategories.map(c=>`<option value="${c}">${c}</option>`).join('');
}
function handleIncCatChange() { document.getElementById('incCategoryCustom').style.display=document.getElementById('incCategory').value==='추가'?'':'none'; }
function updateIncFinanceSelect() {
  const s=document.getElementById('incFinanceSelect'); s.innerHTML='<option value="">선택 안함</option>';
  gFinance.forEach(f=>{ if(document.getElementById('incPayMethod').value==='현금/기타') return; s.innerHTML+=`<option value="${f['금융사명']} ${f['별칭']?`(${f['별칭']})`:''}">${f['금융사명']} ${f['별칭']?`(${f['별칭']})`:''}</option>`; });
  const ifF=document.getElementById('if-finance'); if(ifF) ifF.innerHTML='<option value="all">금융사 (전체)</option>'+gFinance.map(f=>`<option value="${f['금융사명']} ${f['별칭']?`(${f['별칭']})`:''}">${f['금융사명']} ${f['별칭']?`(${f['별칭']})`:''}</option>`).join('');
}
function handleIncPayMethodChange() { document.getElementById('incFinanceWrap').style.display=document.getElementById('incPayMethod').value==='현금/기타'?'none':''; updateIncFinanceSelect(); }

let incFilesBase64=[], incExistingReceipts=[];
function removeIncExisting(i){ incExistingReceipts.splice(i,1); renderIncFilePreview(); }
function removeIncFile(i){ incFilesBase64.splice(i,1); renderIncFilePreview(); }
function renderIncFilePreview() { let h='';
  incExistingReceipts.forEach((u,i)=>h+=`<div class="file-item">🔗 기존 ${i+1} <span onclick="removeIncExisting(${i})" style="cursor:pointer;color:var(--red);margin-left:4px;font-weight:bold;">✕</span></div>`);
  incFilesBase64.forEach((f,i)=>h+=`<div class="file-item">📄 ${f.name.substring(0,10)}... <span onclick="removeIncFile(${i})" style="cursor:pointer;color:var(--red);margin-left:4px;font-weight:bold;">✕</span></div>`);
  document.getElementById('incReceiptPreview').innerHTML=h;
}
function clearIncomeForm() {
  document.getElementById('incId').value=''; ['incAmount','incDetail','incMemo','incCategoryCustom','incReceipts'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('incDate').value=toDateInput(new Date()); document.getElementById('incCategory').value=''; document.getElementById('incCategoryCustom').style.display='none'; incFilesBase64=[]; incExistingReceipts=[]; renderIncFilePreview();
}
function previewIncReceipts(e) {
  const files=Array.from(e.target.files); if(incExistingReceipts.length+incFilesBase64.length+files.length>10){ showToast('최대 10개','error'); e.target.value=''; return; }
  files.forEach(file=>{ const r=new FileReader(); r.onload=ev=>{ if(file.type.startsWith('image/')){ const img=new Image(); img.onload=()=>{ const canvas=document.createElement('canvas'); let w=img.width,h=img.height; const maxSize=1200; if(w>maxSize||h>maxSize){ if(w>h){h*=maxSize/w;w=maxSize;}else{w*=maxSize/h;h=maxSize;} } canvas.width=w; canvas.height=h; canvas.getContext('2d').drawImage(img,0,0,w,h); incFilesBase64.push({name:file.name,mimeType:'image/jpeg',data:canvas.toDataURL('image/jpeg',0.8).split(',')[1]}); renderIncFilePreview(); }; img.src=ev.target.result; } else { incFilesBase64.push({name:file.name,mimeType:file.type,data:ev.target.result.split(',')[1]}); renderIncFilePreview(); } }; r.readAsDataURL(file); }); e.target.value='';
}
function openIncomeModal(id) {
  clearIncomeForm(); const i=id?gIncomes.find(x=>String(x['수입 ID'])===String(id)):null; const isE=!!i;
  document.getElementById('incModalTitle').textContent=isE?'수정':'추가'; document.getElementById('inc-delete-btn').style.display=isE?'block':'none';
  if(isE){ document.getElementById('incId').value=i['수입 ID']; document.getElementById('incDate').value=i['수입일']||''; document.getElementById('incAmount').value=Number(String(i['수입금액']).replace(/[^0-9]/g,'')||0).toLocaleString()+'원'; document.getElementById('incPayMethod').value=i['입금수단']||'계좌이체'; handleIncPayMethodChange(); document.getElementById('incFinanceSelect').value=i['금융사명']||''; const cSel=document.getElementById('incCategory'); if(Array.from(cSel.options).some(o=>o.value===i['수입 카테고리'])){ cSel.value=i['수입 카테고리']; } else { cSel.value='추가'; document.getElementById('incCategoryCustom').style.display=''; document.getElementById('incCategoryCustom').value=i['수입 카테고리']||''; } document.getElementById('incDetail').value=i['세부 항목명']||''; document.getElementById('incMemo').value=i['메모']||''; incExistingReceipts=i['증빙자료링크']?String(i['증빙자료링크']).split(',').filter(l=>l.trim()):[]; renderIncFilePreview(); }
  document.getElementById('incomeModal').style.display='block';
}
function closeIncomeModal() { document.getElementById('incomeModal').style.display='none'; }
function deleteIncomeRecord() {
  const id = document.getElementById('incId').value;
  if (!confirm('정말 삭제하시겠습니까?')) return;
  if (isSubmitting) return showToast('처리 중입니다.', 'error');
  isSubmitting = true;
  showSpinner('삭제 중…');
  google.script.run
    .withSuccessHandler(r => {
      isSubmitting = false;
      closeIncomeModal();
      safeLoadAll();
    })
    .withFailureHandler(e => {
      hideSpinner();
      isSubmitting = false;
      showToast(e.message, 'error');
    })
    .deleteIncome(id);
}

function saveIncomeToSheet(p) {
  google.script.run
    .withSuccessHandler(r => {
      hideSpinner();
      isSubmitting = false;
      if (r.ok) {
        showToast('완료');
        closeIncomeModal();
        safeLoadAll();
      }
    })
    .withFailureHandler(e => {
      hideSpinner();
      isSubmitting = false;
      showToast('저장 실패: ' + e.message, 'error');
    })
    .saveIncome(p);
}
function filterIncomes() { renderIncomeTable(); }
function resetIncomeFilters() { document.getElementById('if-method').value='all'; document.getElementById('if-finance').value='all'; document.getElementById('if-category').value='all'; renderIncomeTable(); }
function renderIncomeTable() {
  const tbody=document.getElementById('incomeBody'); const cM=gm(); const fM=document.getElementById('if-method').value; const fF=document.getElementById('if-finance').value; const fC=document.getElementById('if-category').value;
  let fD=gIncomes.filter(i=>String(i['수입일']).startsWith(cM));
  if(fM!=='all') fD=fD.filter(i=>String(i['입금수단'])===fM); if(fF!=='all') fD=fD.filter(i=>String(i['금융사명'])===fF); if(fC!=='all') fD=fD.filter(i=>String(i['수입 카테고리'])===fC);
  let tot=0; fD.forEach(i=>tot+=(Number(String(i['수입금액']).replace(/[^0-9]/g,''))||0)); const tEl=document.getElementById('incomeTotalAmount'); if(tEl) tEl.textContent=`합계: ${fmtMoney(tot)}`;
  if(!fD.length){ tbody.innerHTML='<tr><td colspan="5" class="empty-state">내역 없음</td></tr>'; return; }
  fD.sort((a,b)=>{ let vA,vB; 
  if(incSortKey==='날짜'){vA=a['수입일'];vB=b['수입일'];} 
  else if(incSortKey==='금액'){vA=Number(String(a['수입금액']).replace(/[^0-9]/g,''))||0; vB=Number(String(b['수입금액']).replace(/[^0-9]/g,''))||0;} 
  else {vA=a[incSortKey]||'';vB=b[incSortKey]||'';} 
  if(vA<vB) return incSortAsc?-1:1; 
  if(vA>vB) return incSortAsc?1:-1; 
  return 0;
 });
  tbody.innerHTML=fD.map(i=>{ const fName=i['금융사명']?` <span style="color:var(--text3);font-size:.75rem;">(${i['금융사명']})</span>`:''; let rHtml=''; if(i['증빙자료링크']){ const lks=i['증빙자료링크'].split(',').filter(l=>l.trim()); if(lks.length) rHtml=`<div style="margin-top:4px;">`+lks.map((l,j)=>`<a href="${l}" target="_blank" class="badge badge-blue" style="margin-right:4px;">첨부 ${j+1}</a>`).join('')+`</div>`; } return `<tr onclick="openIncomeModal('${i['수입 ID']}')" style="cursor:pointer;"><td>${i['수입일']}</td><td><span class="badge badge-gray">${i['입금수단']||'—'}</span>${fName}</td><td><span class="badge badge-green">${i['수입 카테고리']}</span> ${i['세부 항목명']||'—'}${rHtml}</td><td style="color:var(--green);font-weight:600;">${fmtResMoney(i['수입금액'])}</td><td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openIncomeModal('${i['수입 ID']}')">관리</button></td></tr>`; }).join('');
  ['날짜','금액'].forEach(k=>{ const el=document.getElementById('sort-i-'+k); if(el) el.textContent=(incSortKey===k)?(incSortAsc?' ▲':' ▼'):''; });
}

// ============================================================
// 카드 대금 정산
// ============================================================
function renderSettleView() {
  const grid=document.getElementById('settleGrid');
  // 미정산 지출 전체 조회 (gExpenses 중 미정산 신용카드)
  const unsettled=gExpenses.filter(e=>e['결제수단']==='신용카드'&&e['정산상태']==='미정산');
  if(!unsettled.length){ grid.innerHTML='<div style="grid-column:1/-1;" class="empty-state">미정산 건이 없습니다.</div>'; return; }
  const groups={};
  unsettled.forEach(e=>{
    const brand=e['금융사명']||'미지정 신용카드';
    const fInfo=gFinance.find(f=>(f['금융사명']+(f['별칭']?` (${f['별칭']})`:'')).startsWith(brand.split('(')[0].trim()));
    const cutOffStr=fInfo?String(fInfo['이용종료일']||''):''; let cutOffDay=parseInt(cutOffStr.replace(/[^0-9]/g,'')); if(cutOffStr.includes('말')) cutOffDay=31; if(!cutOffDay) cutOffDay=31;
    const expDate=new Date(e['지출일']); let billY=expDate.getFullYear(), billM=expDate.getMonth()+1;
    if(expDate.getDate()>cutOffDay){ billM+=1; if(billM>12){billM=1;billY+=1;} }
    const billKey=`${brand}_${billY}-${String(billM).padStart(2,'0')}`;
    if(!groups[billKey]) groups[billKey]={brand,year:billY,month:billM,cutOffDay,payDay:fInfo?String(fInfo['결제일']||''):'',total:0,items:[]};
    groups[billKey].total+=(Number(String(e['지출금액']).replace(/[^0-9]/g,''))||0); groups[billKey].items.push(e);
  });
  const sKeys=Object.keys(groups).sort();
  grid.innerHTML=sKeys.map(k=>{
    const g=groups[k]; let sM=g.month-1, sY=g.year; if(sM<1){sM=12;sY-=1;}
    const sD=g.cutOffDay===31?1:g.cutOffDay+1; const eD=g.cutOffDay===31?'말일':g.cutOffDay;
    const us=`${sY-2000}. ${sM}. ${sD} ~ ${g.year-2000}. ${g.month}. ${eD}`;
    const pdHtml=getActualPaydayHtml(`${g.year}-${String(g.month).padStart(2,'0')}`,g.payDay); const pdB=pdHtml?`<span class="badge badge-yellow" style="font-size:.8rem;">결제일: ${pdHtml}</span>`:'';
    const bLogo=g.brand.split('(')[0].trim(); const fInfo=gFinance.find(f=>(f['금융사명']+(f['별칭']?` (${f['별칭']})`:'')).startsWith(bLogo)); const lnk=fInfo&&fInfo['연결계좌']?String(fInfo['연결계좌']):'미지정';
    const iList=g.items.map(i=>`<div style="display:flex;justify-content:space-between;font-size:.8rem;padding:4px 0;border-bottom:1px dashed var(--border2);"><span>${i['지출일']} &nbsp;<span class="badge badge-gray">${i['지출 카테고리']}</span> ${i['세부 항목명']||''}</span><span style="color:var(--text2);">${fmtMoney(i['지출금액'])}</span></div>`).join('');
    return `<div class="card" style="display:flex;flex-direction:column;gap:12px;"><div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;font-size:1.1rem;display:flex;align-items:center;">${getFinanceLogoHtml(bLogo)}<span style="margin-left:6px;">${g.brand}</span></div>${pdB}</div><div style="font-size:.8rem;color:var(--text2);"><div>청구기간: ${us}</div><div style="margin-top:4px;color:var(--text3);">🏦 출금계좌: <span style="color:var(--text2);">${lnk}</span></div></div><div style="display:flex;justify-content:space-between;align-items:baseline;padding-bottom:8px;border-bottom:1px solid var(--border);"><span style="color:var(--text2);font-size:.85rem;font-weight:600;">${g.month}월 청구 총액</span><span style="color:var(--red);font-size:1.4rem;font-weight:700;font-family:var(--mono);">${fmtMoney(g.total)}</span></div><div style="background:var(--bg2);padding:10px;border-radius:8px;max-height:160px;overflow-y:auto;">${iList}</div><button class="btn btn-primary btn-block" onclick="settleCard('${g.brand}')">출금 확인 (정산 완료 처리)</button></div>`;
  }).join('');
}
function settleCard(brand) { if(!confirm(`'${brand}' 미정산 건을 정산 완료 처리하시겠습니까?`)) return; showSpinner('처리 중...'); google.script.run.withSuccessHandler(r=>{ hideSpinner(); showToast('정산 완료'); loadAll(); }).settleCardExpenses(brand); }

// ============================================================
// 마스터 설정 (직업/카테고리 관리)
// ============================================================
function openSettingsModal() { switchSetTab('job'); document.getElementById('settingsModal').style.display='block'; }
function closeSettingsModal() { document.getElementById('settingsModal').style.display='none'; }
function switchSetTab(tab) {
  ['job','cat','route'].forEach(t=>{
    document.getElementById('set-btn-'+t).classList.remove('active');
    document.getElementById('set-tab-'+t).style.display='none';
  });
  document.getElementById('set-btn-'+tab).classList.add('active');
  document.getElementById('set-tab-'+tab).style.display='flex';
  if(tab==='job') renderSetJobs();
  else if(tab==='cat') renderSetCats();
  else renderSetRoutes();
}

function renderSetRoutes() {
  const base=['네이버지도','카카오맵','고방','블로그','지인추천','직접방문'];
  const extras=(window.gVisitRoutes||[]).filter(r=>!base.includes(r));
  document.getElementById('set-route-list').innerHTML=
    base.map(r=>`<div class="flex justify-between items-center" style="padding:6px;"><span>${r} <span style="color:var(--text3);font-size:.8rem;">(기본)</span></span></div>`).join('')+
    (extras.length ? extras.map(r=>`<div class="flex justify-between items-center" style="padding:6px;border-bottom:1px dashed var(--border);"><span>${r}</span><div class="flex gap-8"><button class="btn btn-secondary btn-sm" onclick="editMasterData('route','${r}')">수정</button><button class="btn btn-danger btn-sm" onclick="deleteMasterData('route','${r}')">✕</button></div></div>`).join('') : '<div style="color:var(--text3);font-size:.85rem;">추가된 경로 없음</div>');
}
function renderSetJobs() {
  const baseJobs=['미상','학생','직장인','전문직','자영업','배달','건설근로자','무직'];
  document.getElementById('set-job-list').innerHTML=gJobs.map(j=>{
    if(baseJobs.includes(j)) return `<div class="flex justify-between items-center" style="padding:6px;"><span>${j} <span style="color:var(--text3);font-size:.8rem;">(기본)</span></span></div>`;
    return `<div class="flex justify-between items-center" style="padding:6px;border-bottom:1px dashed var(--border);"><span>${j}</span><div class="flex gap-8"><button class="btn btn-secondary btn-sm" onclick="editMasterData('job','${j}')">수정</button><button class="btn btn-danger btn-sm" onclick="deleteMasterData('job','${j}')">✕</button></div></div>`;
  }).join('');
}
function renderSetCats() {
  let html='<div style="font-weight:600;color:var(--accent);margin-bottom:8px;">지출 카테고리</div>';
  html+=gCategories.map(c=>c==='기타'?`<div class="flex justify-between items-center" style="padding:6px;"><span>${c} <span style="color:var(--text3);font-size:.8rem;">(기본)</span></span></div>`:`<div class="flex justify-between items-center" style="padding:6px;border-bottom:1px dashed var(--border);"><span>${c}</span><div class="flex gap-8"><button class="btn btn-secondary btn-sm" onclick="editMasterData('category','${c}')">수정</button><button class="btn btn-danger btn-sm" onclick="deleteMasterData('category','${c}')">✕</button></div></div>`).join('');
  html+='<div style="font-weight:600;color:var(--green);margin-top:16px;margin-bottom:8px;">수입 카테고리</div>';
  html+=gIncomeCategories.map(c=>c==='기타'?`<div class="flex justify-between items-center" style="padding:6px;"><span>${c} <span style="color:var(--text3);font-size:.8rem;">(기본)</span></span></div>`:`<div class="flex justify-between items-center" style="padding:6px;border-bottom:1px dashed var(--border);"><span>${c}</span><div class="flex gap-8"><button class="btn btn-secondary btn-sm" onclick="editMasterData('category','${c}')">수정</button><button class="btn btn-danger btn-sm" onclick="deleteMasterData('category','${c}')">✕</button></div></div>`).join('');
  document.getElementById('set-cat-list').innerHTML=html;
}
function editMasterData(ty,oV) {
  const nV=prompt(`새 이름 입력 (기존 항목 일괄 변경)`,oV); if(!nV||nV.trim()===''||nV===oV) return;
  showSpinner('변경 중...'); google.script.run.withSuccessHandler(r=>{ hideSpinner(); if(r.ok){ showToast(r.msg); loadAll(); closeSettingsModal(); } else showToast(r.msg,'error'); }).updateMasterData({type:ty,oldVal:oV,newVal:nV,action:'edit'});
}
function deleteMasterData(ty,oV) {
  if(!confirm(`'${oV}'을(를) 삭제하시겠습니까? 이 항목으로 등록된 데이터는 기본값으로 변경됩니다.`)) return;
  showSpinner('초기화 중...'); google.script.run.withSuccessHandler(r=>{ hideSpinner(); if(r.ok){ showToast(r.msg); loadAll(); closeSettingsModal(); } else showToast(r.msg,'error'); }).updateMasterData({type:ty,oldVal:oV,action:'delete'});
}

// ============================================================
// 입력 포맷 이벤트 리스너
// ============================================================

// 금액 포맷 (원 자동 붙이기)
function formatMoneyInput(e) {
  let v=e.target.value;
  if(e.inputType==='deleteContentBackward'){ if(v==='워'||v==='원'){ e.target.value=''; return; } if(!v.endsWith('원')&&v.length>0) v=v.slice(0,-1); }
  v=v.replace(/[^0-9]/g,''); e.target.value=v?Number(v).toLocaleString('ko-KR')+'원':'';
}
['m-deposit','m-cleaning-fee','m-due-amount','expAmount','incAmount','pm-amount','rm-rent'].forEach(id=>{ const el=document.getElementById(id); if(el) el.addEventListener('input',formatMoneyInput); });

// 휴대전화 자동 하이픈 (xxx-xxxx-xxxx)
function formatPhone(input) {
  let v=input.value.replace(/[^0-9]/g,'');
  if(v.length<=3) input.value=v;
  else if(v.length<=7) input.value=v.replace(/(\d{3})(\d+)/,'$1-$2');
  else if(v.length<=11) input.value=v.replace(/(\d{3})(\d{4})(\d+)/,'$1-$2-$3');
  else input.value=v.slice(0,11).replace(/(\d{3})(\d{4})(\d{4})/,'$1-$2-$3');
}

document.getElementById('m-phone').addEventListener('input', function() {
  if(document.getElementById('m-contact-type').value==='휴대전화') formatPhone(this);
});
document.getElementById('m-emerg-phone').addEventListener('input', function() {
  formatPhone(this);
});

// 수납일 자동 "일" 붙이기 / 말일 변환
document.getElementById('m-due-day').addEventListener('input', function() {
  let v=this.value.replace(/[^0-9말마ᄆ]/g,'');
  if(v.includes('말')||v.includes('마')||v.includes('ᄆ')){ this.value='말일'; return; }
  if(!v){ this.value=''; return; }
  const n=Number(v);
  if(n>=31){ this.value='말일'; } else if(n>0){ this.value=n+'일'; }
});

// f-payday, f-cutoff 날짜 포맷 (카드 결제일/기준일)
['f-payday','f-cutoff'].forEach(id=>{ const el=document.getElementById(id); if(el) el.addEventListener('input',function(){ let v=this.value.replace(/[^0-9말]/g,''); if(v.includes('말')){ this.value='말일'; return; } if(!v){ this.value=''; return; } const n=Number(v); this.value=n>=31?'말일':(n>0?n+'일':''); }); });

function toggleColSettings(tableId) {
  const panel=document.getElementById('colPanel-'+tableId); if(!panel) return;
  const isOpen=panel.classList.contains('open');
  document.querySelectorAll('.col-settings-panel.open').forEach(p=>p.classList.remove('open'));
  if(isOpen) return;
  const table=document.getElementById(tableId); if(!table) return;
  const ths=Array.from(table.querySelectorAll('thead th'));
  const hidden=JSON.parse(localStorage.getItem('colHide_'+tableId)||'[]');
  panel.innerHTML=ths.map((th,i)=>{
    const label=th.getAttribute('data-col')||(th.innerText.replace(/[▲▼]/g,'').trim())||`열${i+1}`;
    const checked=hidden.includes(i)?'':'checked';
    return `<label class="col-settings-item"><input type="checkbox" ${checked} onchange="setColVisibility('${tableId}',${i},this.checked)"> ${label}</label>`;
  }).join('');
  panel.classList.add('open');
}
document.addEventListener('click',e=>{
  if(!e.target.closest('.col-settings-wrap')) document.querySelectorAll('.col-settings-panel.open').forEach(p=>p.classList.remove('open'));
});
function setColVisibility(tableId,colIdx,visible) {
  const saved=JSON.parse(localStorage.getItem('colHide_'+tableId)||'[]');
  const updated=visible?saved.filter(i=>i!==colIdx):[...new Set([...saved,colIdx])];
  localStorage.setItem('colHide_'+tableId,JSON.stringify(updated));
  applyColVisibility(tableId);
}
function applyColVisibility(tableId) {
  const table=document.getElementById(tableId); if(!table) return;
  const hidden=JSON.parse(localStorage.getItem('colHide_'+tableId)||'[]');
  const ths=table.querySelectorAll('thead th');
  ths.forEach((th,i)=>{ const hide=hidden.includes(i); th.style.display=hide?'none':''; table.querySelectorAll('tbody tr').forEach(tr=>{ if(tr.cells[i]) tr.cells[i].style.display=hide?'none':''; }); });
}
function initAllColSettings() {
  ['roomStatusTable','tenantTable','expenseTable','incomeTable'].forEach(applyColVisibility);
}
// 수납 모달 내 보증금 입력칸 토글
function toggleDepositInput() {
  const chk = document.getElementById('pm-include-deposit');
  const wrap = document.getElementById('pm-deposit-input-wrap');
  if(chk && wrap) wrap.style.display = chk.checked ? 'block' : 'none';
}

// 보증금 정산 모달 열기 (새로운 데이터 구조 대응)
function openDepositSettleModal() {
  const tenantId = document.getElementById('m-id').value;
  const t = gTenants.find(x => String(x['입주자 ID']) === String(tenantId));
  if(!t) return;

  const dep = Number(String(t['보증금 금액'] || '').replace(/[^0-9]/g, '')) || 0;
  const clean = Number(String(t['청소비'] || '').replace(/[^0-9]/g, '')) || 0;
  
  // 통합 수납 현황 리스트에서 실시간 잔액(미납금) 가져오기
  const rs = gRoomStatus.find(r => String(r.호실) === String(t['현재 호실']));
  const unpaid = rs ? Math.max(0, -(Number(rs.잔액) || 0)) : 0;
  
  document.getElementById('ds-total').textContent = fmtMoney(dep);
  document.getElementById('ds-clean').value = clean ? clean.toLocaleString() + '원' : '';
  document.getElementById('ds-damage').value = '';
  document.getElementById('ds-unpaid').textContent = fmtMoney(unpaid);
  
  calcDepositSettle();
  document.getElementById('depositSettleModal').style.display = 'block';
}

// 실시간 정산액 계산 함수
function calcDepositSettle() {
  const total = Number(document.getElementById('ds-total').textContent.replace(/[^0-9]/g, '')) || 0;
  const clean = Number(document.getElementById('ds-clean').value.replace(/[^0-9]/g, '')) || 0;
  const damage = Number(document.getElementById('ds-damage').value.replace(/[^0-9]/g, '')) || 0;
  const unpaid = Number(document.getElementById('ds-unpaid').textContent.replace(/[^0-9]/g, '')) || 0;
  
  const refund = Math.max(0, total - clean - damage - unpaid);
  const el = document.getElementById('ds-refund');
  if(el) {
    el.textContent = fmtMoney(refund);
    el.style.color = refund > 0 ? 'var(--green)' : 'var(--red)';
  }
}

// 정산 완료 처리 (Backend 연동)
function submitDepositSettle() {
  const tenantId = document.getElementById('m-id').value;
  const t = gTenants.find(x => String(x['입주자 ID']) === String(tenantId));
  if(!t || !confirm('보증금 정산을 완료 처리하시겠습니까? (반환액이 지출로 자동 기록됩니다)')) return;
  
  const refund = Number(document.getElementById('ds-refund').textContent.replace(/[^0-9]/g, '')) || 0;
  const memo = document.getElementById('ds-memo').value;
  
  if(refund > 0) {
    showSpinner('보증금 정산 처리 중...');
    google.script.run.withSuccessHandler(r => {
      hideSpinner(); 
      showToast('보증금 정산 완료! 지출 내역을 확인하세요.');
      closeDepositSettleModal(); 
      loadAll();
    }).saveExpense({ 
      date: toDateInput(new Date()), 
      amount: String(refund), 
      category: '보증금 반환', 
      detail: `${t['현재 호실']}호 ${t['입주자명']} 보증금 반환`, 
      memo: memo, 
      payMethod: '계좌이체', 
      settleStatus: '정산완료' 
    });
  } else {
    showToast('반환할 금액이 없습니다. (정산 완료)');
    closeDepositSettleModal();
  }
}
// 보증금 정산 모달 닫기
function closeDepositSettleModal() {
  const modal = document.getElementById('depositSettleModal');
  if (modal) {
    modal.style.display = 'none';
  }
}
</script>
</body>
</html>

4. 향후 구현 로드맵 (Priority)
Phase 3+ (Finance): FinancialAccount, Expense, Income Prisma 스키마 설계 및 자산 관리 기능 이관.

Phase 3.5 (Settle): 신용카드 결제일/기준일 기반 정산 자동화 로직 구현.

Phase 4 (Room Detail): 호실 상세 컨디션 필드 확장 및 UI 고도화.

Phase 5 (Media): Supabase Storage를 활용한 영수증/사진 업로드 엔진 탑재.